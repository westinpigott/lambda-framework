'use strict';

class TestController{
	constructor(config, getLib){
		this.getLib = getLib;
		this.config = config;
	}
	getItems(){
		return Promise.resolve({
			hello: 'world',
			shared: this.getLib('shared')
		});
	}
}

module.exports = TestController;
