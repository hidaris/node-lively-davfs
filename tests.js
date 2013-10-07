var livelyRepositories = require('./repository'),
    path = require("path"),
    util = require("util"),
    async = require("async"),
    request = require("request"),
    fsHelper = require("lively-fs-helper"),
    port = 9009, testRepo;

function put(path, content, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request.put(url, {body: content}, function(err, res) {
        console.log('PUT done'); thenDo(err); });
}
function del(path, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request(url, {method: 'DELETE'}, function(err, res) {
        console.log('DELETE done'); thenDo(err); });
}

var tests = {
    setUp: function (callback) {
        async.series([
            function(next) {
                var files = {
                    "testDir": {"aFile.txt": 'foo bar content'}
                };
                // var files = {
                //     "testDir": {
                //         "aFile.txt": 'foo bar content',
                //         "dir1": {
                //             "otherFile.txt": "content content content",
                //             "boing.jpg": "imagin this would be binary",
                //             "dir1.1": {"xxx.txt": 'ui'}
                //         },
                //         "dir2": {
                //             "file1.foo": "1",
                //             "file2.foo": "2"
                //         },
                //         "dir3": {}
                //     }
                // };
                fsHelper.createDirStructure(process.cwd(), files, next);
            },
            function(next) {
                livelyRepositories.start({
                    fs: path.join(process.cwd(), "testDir"),
                    port: port,
                    excludedDirectories: ['.git', 'node_modules'],
                }, function(err, repo) { testRepo = repo; next(err); })
            }
        ], callback);
    },
    tearDown: function (callback) {
        async.series([
            livelyRepositories.stop.bind(null, testRepo),
            fsHelper.cleanupTempFiles
        ], callback);
    },
    testFileList: function(test) {
        test.expect(3);
        testRepo.getFiles(function(err, files) {
            test.equal(files.length, 1, '# files');
            test.equal(files[0].path, 'aFile.txt', 'file name');
            test.equal(files[0].change, 'initial', 'no change');
            test.done();
        });
    },
    testPutCreatesNewVersion: function(test) {
        test.expect(3);
        async.series([
            put.bind(null, 'aFile.txt', 'test'),
            function(next) {
                testRepo.getFiles(function(err, files) {
                    test.equal(files.length, 1, '# files');
                    test.equal(files[0].path, 'aFile.txt', 'file name');
                    test.equal(files[0].change, 'contentChange', 'no change recorded');
                    next();
                });
            }
        ], test.done);
    },
    testDeleteIsRecorded: function(test) {
        test.expect(5);
        async.series([
            del.bind(null, 'aFile.txt'),
            function(next) {
                testRepo.getVersionsFor('aFile.txt', function(err, versions) {
                    test.equal(versions.length, 2, '# versions');
                    test.equal(versions[0].path, 'aFile.txt', 'v1: path');
                    test.equal(versions[0].change, 'initial', 'v1: change');
                    test.equal(versions[1].path, 'aFile.txt', 'v2: path');
                    test.equal(versions[1].change, 'deletion', 'v2: change');
                    next();
                });
            }
        ], test.done);
    },
    testDAVCreatedFileIsFound: function(test) {
        test.expect(4);
        async.series([
            put.bind(null, 'writtenFile.txt', 'test'),
            function(next) {
                testRepo.getFiles(function(err, files) {
                    test.equal(files.length, 2, '# files');
                    test.equal(files[0].path, 'aFile.txt', 'file name');
                    test.equal(files[1].path, 'writtenFile.txt', 'file name 2');
                    test.equal(files[1].change, 'created', 'file 2 change');
                    next();
                });
            }
        ], test.done);
    },
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
