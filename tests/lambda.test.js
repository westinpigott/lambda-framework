'use strict';

var Path = require('path');

var assert = require('chai').assert;

describe('Lambda', function () {

	it.only('should run the lambda', function (done) {
		var runLambda = require('../lambda/run');

		var run = runLambda({
			localMode: false,
			libsPath: Path.join(__dirname, 'fixtures/deployedLambda/libs'),
			servicePath: Path.join(__dirname, 'fixtures/deployedLambda'),
			controllerPath: Path.join(__dirname, 'fixtures/deployedLambda')
		});


		var request = {
			action: 'getItems',
			body: {
				category: 'shoes'
			}
		};

		run(request, {}, function (error, result) {
			if (error) {
				return done(error);
			}
			assert.equal(result.hello, 'world');
			done();
		});

	});

});

