'use strict';

var Path = require('path');

var Promise = require('bluebird');

var runInitializer = require('./lambda/run');

module.exports = function (options) {
	const ROOT_DIR = options.root;
	const APP_DIR = Path.join(ROOT_DIR, 'app');
	const ENV = options.env || 'test';
	return {
		fetch: function (service, request) {

			let run = runInitializer({
				appPath: APP_DIR,
				env: ENV,
				service: service,
				localMode: true
			});

			return new Promise(function (resolve) {
				run(request, null, function (error, response) {
					if (error) {
						return resolve({
							'errorMessage': error.message,
							'errorType': error.name,
							'stackTrace': error.stack.split(/\n/)
						});
					}
					return resolve(response);
				});
			});
		}
	};

};
