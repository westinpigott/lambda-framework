'use strict';

var fs = require('fs'),
	Path = require('path');

var gulp = require('gulp'),
	_ = require('lodash'),
	lambda = require('gulp-awslambda'),
	zip = require('gulp-zip'),
	source = require('vinyl-source-stream'),
	eventStream = require('event-stream'),
	Promise = require('bluebird');

var AWS = require('aws-sdk');

function vinylFile(fileName, contents) {
	var stream = source(fileName);
	stream.end(contents);
	return stream;
}
var exec = function (command, cwd, streamOutput) {
	var options = {
		cwd: cwd,
		stdio: streamOutput ? [0, 1, 2] : undefined
	};
	return require('child_process').execSync(command, options);
};

module.exports = function (options, tools) {
	var ROOT_DIR = options.root;
	var APP_DIR = ROOT_DIR + '/app';

	var gatewayApi = Promise.promisifyAll(new AWS.APIGateway({
		region: 'us-west-2',
		apiVersion: '2015-07-09'
		// apiVersion: config.AWS.APIGateway.apiVersion
	}));

	var lambdaInstance = new AWS.Lambda({
		region: 'us-west-2',
		lambda: '2015-03-31',
		// apiVersion: config.AWS.APIGateway.apiVersion
	});
	lambdaInstance.invokeAsyncOriginal = lambdaInstance.invokeAsync;
	var lambdaApi = Promise.promisifyAll(_.omit(lambdaInstance, ['invokeAsync']));

	return {
		deployLambda: function (settings) {

			var BUILD_DIR = Path.resolve(ROOT_DIR, settings.buildFolder);
			var NM_DIR = BUILD_DIR + '/nm';

			var SERVICE_DIR = ROOT_DIR + '/app/services/' + settings.service;

			var rootConfig = tools.configRequire(ROOT_DIR + '/config', settings.env, true);
			var serviceConfig = tools.configRequire(SERVICE_DIR + '/config', settings.env, true);

			var config = _.merge({
				SERVICE_NAME: settings.service
			}, rootConfig, serviceConfig);
			var functionName = (config.lambdaPrefix || '') + settings.service;
			var lambda_params = {
				FunctionName: functionName,
				Role: config.lambdaRole
			};
			var lambda_opts = {
				region: config.region
			};

			return new Promise(function (resolve) {
				gulp.src('./package.json')
					.pipe(gulp.dest('./build/nm'))
					.on('finish', function () {

						exec('npm install --production', NM_DIR, true);

						eventStream
							.merge([
								vinylFile('config.json', JSON.stringify(config, null, 2)),
								// we need to add the base so that the files actually get added to the libs folder instead of the root
								gulp.src([
									APP_DIR + '/libs/**',
									APP_DIR + '/decorators/**',
									APP_DIR + '/services/' + settings.service + '/**',
								], {base: APP_DIR}),
								gulp.src([
									__dirname + '/lambda/**',
									NM_DIR + '/**'
								])
							])
							.pipe(zip(lambda_params.FunctionName + '.zip'))
							.pipe(lambda(lambda_params, lambda_opts))
							.pipe(gulp.dest(BUILD_DIR))
							.on('finish', resolve);
					});
			});

		},
		deployAllLambdas: function (settings) {
			var services = fs.readdirSync(ROOT_DIR + '/app/services');
			return Promise.all(services.map((service)=> {
				return this.deployLambda(_.assign({
					service: service
				}, settings));
			}));
		},
		deployApi: function (settings) {

			var SERVICE_DIR = ROOT_DIR + '/app/services/' + settings.service;

			var rootConfig = tools.configRequire(ROOT_DIR + '/config', settings.env);
			var serviceConfig = tools.configRequire(SERVICE_DIR + '/config', settings.env);

			var config = _.merge({}, rootConfig, serviceConfig);
			var functionName = (config.lambdaPrefix || '') + settings.service;

			var resourcePath = settings.service;

			var restApiId = config.restApiId;
			var lambdaApiVersion = _.get(config, 'apiVersions.lambda', '2015-03-31');

			var rootResource,
				resources,
				functionInfo;
			return gatewayApi
				.getResourcesAsync({
					restApiId: restApiId,
					limit: 100
				})
				.then(function (data) {
					resources = data.items;
					rootResource = _.find(data.items, {path: '/'});
				})
				.then(function () {

					var resource = _.find(resources, {path: '/' + resourcePath, parentId: rootResource.id});
					if (resource) {
						return gatewayApi.deleteResourceAsync({
							resourceId: resource.id,
							restApiId: restApiId
						});
					}

				})
				.then(function () {
					return gatewayApi.createResourceAsync({
						restApiId: restApiId,
						parentId: rootResource.id,
						pathPart: resourcePath, /* required */
					});
				})
				.then(function (result) {
					var httpMethod = 'POST';
					return gatewayApi.putMethodAsync({
						authorizationType: 'NONE',
						httpMethod: 'POST',
						resourceId: result.id,
						restApiId: restApiId, /* required */
						apiKeyRequired: false, /* true || false */
						// requestModels     : requestModels(),
						// requestParameters : requestParameters(opt.resource.path),
					})
						.then(function () {
							return lambdaApi
								.getFunctionAsync({
									FunctionName: functionName, /* required */
									// Qualifier: 'STRING_VALUE'
								})
								.then(function (res) {
									functionInfo = res.Configuration;
								});
						})
						.then(function () {
							// http://docs.aws.amazon.com/lambda/latest/dg/with-on-demand-https-example-configure-event-source.html
							return lambdaApi
								.addPermissionAsync({
									Action: 'lambda:InvokeFunction', //required  look up operations i.e. lambda:CreateFunction
									FunctionName: functionName, /* required */
									Principal: 'apigateway.amazonaws.com', /* required */
									StatementId: ('id_' + Date.now() + Math.random()).replace('.', ''), /* required */
									// EventSourceToken: '',
									// Qualifier: '',
									// SourceAccount: '',
									// SourceArn: 'arn:aws:execute-api:us-east-1:'+config.accountId+':'+restApiId+'/*/POST/' + settings.service
								});

						})
						.then(function () {
							// get correct api version looking at http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Lambda.html
							// http://docs.aws.amazon.com/cli/latest/reference/gatewayApi/put-integration.html
							// http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/gatewayApi.html#putIntegration-property
							// https://forums.aws.amazon.com/thread.jspa?messageID=685551
							return gatewayApi.putIntegrationAsync({
								httpMethod: httpMethod,
								resourceId: result.id,
								restApiId: restApiId,
								type: 'AWS',
								cacheKeyParameters: [],
								// credentials: '',
								integrationHttpMethod: 'POST', // this MUST be post: https://github.com/awslabs/aws-gatewayApi-importer/issues/9
								passthroughBehavior: 'WHEN_NO_MATCH',
								// requestParameters: '',
								// requestTemplates: '',
								uri: 'arn:aws:apigateway:us-west-2:lambda:path/' + lambdaApiVersion + '/functions/' + functionInfo.FunctionArn + '/invocations'
							});
						})
						.then(function () {
							return gatewayApi.putMethodResponseAsync({


								httpMethod: httpMethod,
								resourceId: result.id,
								restApiId: restApiId,

								statusCode: '200', /* required */
								responseModels: {
									/* someKey: 'STRING_VALUE' */
								},
								responseParameters: {
									/* someKey: true || false */
								}
							});
						})
						.then(function () {
							return gatewayApi.putIntegrationResponseAsync({

								httpMethod: httpMethod,
								resourceId: result.id,
								restApiId: restApiId,
								statusCode: '200', /* required */
								responseParameters: {
									/* someKey: 'STRING_VALUE' */
								},
								responseTemplates: {
									/* someKey: 'STRING_VALUE' */
								},
								selectionPattern: '.*'
							});
						});
				})
				.then(function (res) {
					return res;
				});

		},
		deployAllApis: function (settings) {
			var services = fs.readdirSync(ROOT_DIR + '/app/services');
			return Promise.resolve(services)
				.map((service)=>{
					return this.deployApi(_.assign({
						service: service
					}, settings));
				}, {concurrency: 1});
		},
		deployAll: function (settings) {
			return this.deployAllLambdas(settings)
				.then(()=> {
					return this.deployAllApis(settings);
				});
		}
	};

};
