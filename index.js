'use strict';

let Path = require('path');

let express = require('express'),
    bodyParser = require('body-parser'),
    _ = require('lodash'),
    cors = require('cors');

let morgan = require('morgan');

let _tools = require('./tools'),
    _testHelper = require('./testHelper'),
    runInitializer = require('./lambda/run');

const runInitializers = {};

// start a new http server that will load up the different

module.exports = function (options) {
    const ROOT_DIR = options.root;
    const APP_DIR = Path.join(ROOT_DIR, 'app');

    let tools = _tools(options);
    let gulp;
    let testHelper = _testHelper(options);
    return {
        tools: tools,
        gulp: function () {
            if (!gulp) {
                const _gulp = require('./gulp');
                gulp = _gulp(options, tools);
            }

            return gulp
        },
        testHelper: testHelper,
        start: function (serverOptions) {
            var environment = serverOptions.env || 'dev';
            let config = tools.configRequire(Path.join(ROOT_DIR, '/config'), environment);

            let port = _.get(config, 'server.port', 3000);
            let morganConfig = {
                format: _.get(config, 'express_morgan.format', 'tiny'),
                options: _.get(config, 'express_morgan.options', {
                    skip: function (req, res) {
                        return true
                    }
                })
            };
            let app = express();

            app.use(bodyParser.json({limit: config.jsonBodyParserLimit || '20mb'}));
            app.use(cors());
            app.use(morgan(morganConfig.format, morganConfig.options));
            app.get('/health', function (req, res) {
                res.status(200).send('OK')
            });
            app.get('/api/:version/auth/fitbit/callback*', function (req, res) {

                const code = req.query.code;
                const state = req.query.state;
                const service = "sleep";

                Object.assign(req.body, {
                    action: 'saveFitbit',
                    username: state,
                    code,
                    type: 'fitbit',
                });


                if (!runInitializers[service]) {
                    runInitializers[service] = runInitializer({
                        appPath: APP_DIR,
                        env: environment,
                        service: service,
                        localMode: true
                    });
                }
                let run = runInitializers[service];[]
                run(req.body, null, function (error, response) {
                    if (error) {
                        return res.json({
                            'errorMessage': error.message,
                            'errorType': error.name,
                            'stackTrace': error.stack.split(/\n/)
                        });
                    }
                    // redirecting to same endpoint but removed call back to FE to save user info
                    res.redirect(302, 'rollingstrong://#/sleep/fitbit/authorize?code=' + code + '&state=' + state);
                });


            });
            app.get('/', function (req, res) {
                res.send({msg: 'This is CORS-enabled for all origins!'});
            });
            let count = 0;
            app.post('/api/:version/:service', function (req, res) {
                if (req.params.service === 'sleep') {
                    console.log('sleep called', count++, 'times')
                }
                var service = req.params.service;

                if (!runInitializers[service]) {
                    runInitializers[service] = runInitializer({
                        appPath: APP_DIR,
                        env: environment,
                        service: service,
                        localMode: true
                    });
                }
                let run = runInitializers[service];[]

                run(req.body, null, function (error, response) {
                    if (error) {
                        return res.json({
                            'errorMessage': error.message,
                            'errorType': error.name,
                            'stackTrace': error.stack.split(/\n/)
                        });
                    }
                    return res.json(response);
                });
            });

            app.listen(port, function () {
                console.log('Server listening on port: ' + port);
            });

        },
        stop: function () {

        },
        initSQS: function(serverOptions) {
            var service = 'sqsmonitor';

            const body = {
                action: 'init',
            };

            if (!runInitializers[service]) {
                runInitializers[service] = runInitializer({
                    appPath: APP_DIR,
                    env: serverOptions.env || 'dev',
                    service: service,
                    localMode: true
                });
            }
            let run = runInitializers[service];[]

            run(body, null, function (error, response) {
                if (error) {
                    return res.json({
                        'errorMessage': error.message,
                        'errorType': error.name,
                        'stackTrace': error.stack.split(/\n/)
                    });
                }
                return response;
            });
        },
    };
};
