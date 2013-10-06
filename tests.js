var livelyRepositories = require('./repository'),
    path = require("path"),
    async = require("async"),
    request = require("request"),
    fsHelper = require("lively-fs-helper"),
    port = 9009, testRepo;

var tests = {
    setUp: function (callback) {
        async.series([
            function(next) {
                var files = {"testDir": {"aFile.txt": 'foo bar content'}};
                fsHelper.createDirStructure(process.cwd(), files, next);
            },
            function(next) {
                livelyRepositories.createRepository({
                    fs: path.join(process.cwd(), "testDir"), port: port,
                }, function(err, repo) { testRepo = repo; next(err); })
            }
        ], callback);
    },
    tearDown: function (callback) {
        async.series([
            function(next) {
                livelyRepositories.removeRepository(testRepo, next)
            },
            fsHelper.cleanupTempFiles
        ], callback);
    },
    testFileList: function (test) {
        test.expect(2)
        testRepo.listFiles(function(err, files) {
            test.equal(files.length, 1, '# files');
            test.equal(files[0].path, 'aFile.txt', 'file name');
            test.done();
        });
        // test.deepEqual(subserver.routes, ['gettest'], 'routes');
        // serverManager.get(server,'/test', function(err, res, body) {
        //     test.equal(body, 'foo', 'subserver get');
        //     test.done();
        // });
    }
};

module.exports = tests;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

// var subserver;
// function makeSubserver(route) {
//     subserver = function(route, server) {
//         server.get(route, function(req, res) { res.end('foo'); });
//     }
//     subserver.route = route;
//     return subserver;
// }

// var tests = {
//     setUp: function (callback) {
//         serverManager.start({
//             port: port,
//             subservers: [makeSubserver('/test')]
//         }, function(err, s) { server = s; callback(err); });
//     },
//     tearDown: function (callback) {
//         async.series([
//             serverManager.stop.bind(null, server),
//             fsHelper.cleanupTempFiles
//         ], callback);
//     },
//     testSubserverRequest: function (test) {
//         test.deepEqual(subserver.routes, ['gettest'], 'routes');
//         serverManager.get(server,'/test', function(err, res, body) {
//             test.equal(body, 'foo', 'subserver get');
//             test.done();
//         });
//     },
//     testSubserverUnload: function (test) {
//         serverManager.unload(server, subserver);
//         test.deepEqual(subserver.routes, [], 'routes');
//         test.done();
//     },
//     testSubserverConfig: function (test) {
//         var subserverSource = "module.exports = function(baseRoute, app) {\n"
//                             + "    app.get(baseRoute, function(req, res) {\n"
//                             + "        res.end('hello'); });\n"
//                             + "}",
//             configSource = '{"subservers":{"subserver.js":{"route":"/test2"}}}',
//             files = {testSubserverFromFile: {"subserver.js": subserverSource, "config.json": configSource}};
//         async.waterfall([
//             fsHelper.createDirStructure.bind(null, '.', files),
//             serverManager.loadConfig.bind(null, server, "testSubserverFromFile/config.json"),
//             serverManager.get.bind(null, server,'/test2'), // --> res, body
//             function assert(res, body, next) {
//                 test.equal(body, 'hello', 'subserver get'); next();
//             }
//         ], test.done);
//     },
//     testSubserverConfigReload: function (test) {
//         var subserverSource = "module.exports = function(baseRoute, app) {\n"
//                             + "    app.get(baseRoute, function(req, res) {\n"
//                             + "        res.end('hello'); });\n"
//                             + "}",
//             configSource1 = '{"subservers":{"subserver.js":{"route":"/test1"}}}',
//             configSource2 = '{"subservers":{"subserver.js":{"route":"/test2"}}}',
//             files = {testSubserverFromFile: {"subserver.js": subserverSource, "config1.json": configSource1, "config2.json": configSource2}};
//         async.waterfall([
//             fsHelper.createDirStructure.bind(null, '.', files),
//             serverManager.reloadConfig.bind(null, server, "testSubserverFromFile/config1.json"),
//             serverManager.reloadConfig.bind(null, server, "testSubserverFromFile/config2.json"),
//             serverManager.get.bind(null, server,'/test1'), // --> res, body
//             function(res, body, next) {
//                 test.equal(404, res.statusCode, 'subserver get old'); next();
//             },
//             serverManager.get.bind(null, server,'/test2'), // --> res, body
//             function(res, body, next) {
//                 test.equal(body, 'hello', 'subserver get'); next();
//             }
//         ], test.done);
//     }
// };

// module.exports = tests;
