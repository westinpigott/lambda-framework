'use strict';

let Path = require('path');

let express = require('express'),
	bodyParser = require('body-parser'),
	_ = require('lodash'),
	cors = require('cors');

let _tools = require('./tools'),
	_gulp = require('./gulp'),
	_testHelper = require('./testHelper'),
	runInitializer = require('./lambda/run');

// start a new http server that will load up the different

module.exports = function(options){
	const ROOT_DIR = options.root;
	const APP_DIR = Path.join(ROOT_DIR, 'app');

	let tools = _tools(options);
	let gulp = _gulp(options, tools);
	let testHelper = _testHelper(options);
	return {
		tools: tools,
		gulp: gulp,
		testHelper: testHelper,
		start: function(serverOptions){
			var environment = serverOptions.env || 'dev';
			let config = tools.configRequire(Path.join(ROOT_DIR, '/config'), environment);



			let port = _.get(config, 'server.port', 3000 );
			let app = express();

			app.use(bodyParser.json());
			app.use(cors());
			app.get('/auth/fitbit/callback', function(req, res) {
				res.status(302).redirect('/sleep');
			});
			app.get('/', function(req, res){
				res.send({msg: 'This is CORS-enabled for all origins!'});
			});
			app.post('/api/:version/:service', function(req, res) {

				var service = req.params.service;
				let run = runInitializer({
					appPath: APP_DIR,
					env: environment,
					service: service,
					localMode: true
				});

				run(req.body, null, function(error, response){
					if(error){
						return res.json({
							'errorMessage': error.message,
							'errorType': error.name,
							'stackTrace': error.stack.split(/\n/)
						});
					}
					return res.json(response);
				});
			});

			app.listen(port, function(){
				console.log('Server listening on port: ' + port);
			});

		},
		stop: function(){

		}
	};
};
