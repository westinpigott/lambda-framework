'use strict';

var Path = require('path'),
	_ = require('lodash');

module.exports = function () {
	return {
		configRequire: function (path, env, skipLocal) {

			var fullPath = Path.join(path, 'config');
			var parts = [];
			var modifiedParts = _.map(env ? env.split('.') : null, (part)=> {
				parts.push(part);
				return parts.join('.');
			});
			var hierarchy = [''].concat(modifiedParts);
			if (!skipLocal) {
				hierarchy.push('local');
			}
			var result = {};

			_.each(hierarchy, function (ext) {
				var extendedPath = ext ? fullPath + '.' + ext : fullPath;
				try {
					_.merge(result, require(extendedPath));
				} catch (error) {
					// we want to throw an error if it is the original file or it is not a module_not_found error
					if (error.code !== 'MODULE_NOT_FOUND' || !ext) {
						throw error;
					}
				}
			});

			return result;

		}
	};
};
