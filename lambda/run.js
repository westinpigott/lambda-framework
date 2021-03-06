'use strict';

var Path = require('path');

var _ = require('lodash'),
	Promise = require('bluebird');


var instanceCount = 0;

let bootstrapResult;
function bootstrap(config, bootstrapPath){
	if(bootstrapResult){
		return bootstrapResult;
	}
	try{
		let bootstrapMethod = require(bootstrapPath);
		bootstrapResult = bootstrapMethod(config)
			.then((results)=>{
				bootstrapResult = results;
				return results;
			});
	}catch(e){
		if(e.code === 'MODULE_NOT_FOUND'){
			bootstrapResult = {};
		}else{
			throw e;
		}
	}

	return bootstrapResult;
}

module.exports = function (overrides) {

	let options = Object.assign({
		appPath: __dirname,
		localMode: false,
		// service: 'test', this will be compiled into config.SERVICE_NAME when deployed
		// env: 'test'
	}, overrides);


	let config;

	if (options.localMode) {
		let tools = require('../tools')({});

		let rootConfig = tools.configRequire(Path.join(options.appPath, '..', 'config'), options.env);
		let serviceConfig = tools.configRequire(Path.join(options.appPath, 'services/' + options.service + '/config'), options.env);

		config = _.merge({}, rootConfig, serviceConfig);

	} else {
		config = require('./config');
		// when service is build for amazon the name of the service is added to the compiled config since we don't pass overrides
		options.service = config.SERVICE_NAME;
	}


	let loadedControllerData;
	function loadControllerData(bootstrapData){
		if(loadedControllerData){
			return Promise.resolve(loadedControllerData);
		}

		var controllerPath = Path.join(options.appPath, 'services/' + options.service);

		var preExistingDependencies = _.assign({
			config: config
		}, bootstrapData.dependencies);

		function getDependencies(klass) {
			var str = klass.toString(),
				argsStr;
			// first check if this is a class or function
			if (str.match(/^class[ \{]/)) {
				argsStr = _.get(str.match(/constructor\s*[^\(]*\(\s*([^\)]*)\)/m), '[1]', '');
			} else {
				argsStr = str.match(/^function\s*[^\(]*\(\s*([^\)]*)/m)[1];
			}
			if (!argsStr.trim()) {
				return [];
			}
			var args = _.map(argsStr.split(','), function (arg) {
				var result = arg.trim();
				return result;
			});
			return args;
		}

		function createInstance(klass) {
			if (!_.isFunction(klass)) {
				return klass;
			}
			var dependencies = getDependencies(klass);

			var instances = _.map(dependencies, function (dependency) {
				if (preExistingDependencies[dependency]) {
					return preExistingDependencies[dependency];
				}
				var _klass = require(Path.join(options.appPath, 'libs', dependency));
				return createInstance(_klass);
			});

			return new (klass.bind.apply(klass, [klass].concat(instances)))();
		}

		const Controller = require(Path.join(controllerPath, config.controller || 'controller'));

		const controller = createInstance(Controller);

		let next = function (event) {
			return Promise.resolve(controller[event.action](event || {}))
				.then(function (result) {
					if (result) {
						result.instanceCount = (instanceCount++);
					}
					return result;
				});
		};

		var decorators = Object.assign(controller.decorators || {}, config.decorators || {});

		_.each(decorators, function (item, key) {
			let decorator = require(Path.join(options.appPath, 'decorators', key));
			next = decorator(next, {
				options: item,
				controller: controller,
				config: config
			});
		});



		loadedControllerData = [controller, next];

		return Promise.resolve(loadedControllerData);
	}

	function formatAndLogError(error) {
		var stackTrace = 'No Stack Trace Available.';
		if(error.stack) {
            stackTrace = error.stack.split(/\n/);
		}
		console.error(error);
		return {
			statusCode: 500,
			'errorMessage': error.message,
			'errorType': error.name,
			'stackTrace': stackTrace,
		};
	}

	return function (event, context, callback) {
		return Promise.resolve(bootstrap(config, Path.join(options.appPath, 'bootstrap')))
			.then((bootstrapData)=>{
				return loadControllerData(bootstrapData)
			})
			.spread((controller, next)=>{
				if (!controller[event.action]) {
					return callback(null, formatAndLogError(new Error('Controller action ' + event.action + ' does not exist')));
				}
				if (!config.actions || !config.actions[event.action]) {
					return callback(null, formatAndLogError(new Error('Controller action ' + event.action + ' is missing from the config')));
				}
				event.body = event.body || {};
				return Promise.resolve(next(event, callback))
					.then(function (_result) {
						let result = _result || {};
						result.statusCode = result.statusCode || 200;
						callback(null, result);
					})
			})
			.catch(function (error) {
				callback(null, formatAndLogError(error));
			});


	};
};

