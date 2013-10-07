var Repository = require('./repository'),
    path = require("path"),
    util = require("util"),
    async = require("async"),
    request = require("request"),
    http = require("http"),
    fsHelper = require("lively-fs-helper"),
    d = require("./domain"),
    port = 9009, testRepo, testServer,
    baseDirectory = process.cwd(),
    testDirectory = path.join(baseDirectory, "testDir");

var FsTree = require('jsdav/lib/DAV/backends/fs/tree');
function createServer(repo, handlerFunc, thenDo) {
    var server = http.createServer(handlerFunc)
    server.tree = FsTree.new(testDirectory);
    server.tmpDir = './tmp'; // httpPut writes tmp files
    server.options = {};
    server.plugins = {livelydav: repo.getDAVPlugin()};
    if (!server.baseUri) server.baseUri = '/';
    if (!server.getBaseUri) server.getBaseUri = function() { return this.baseUri };
    server.on('close', function() { console.log('lively fs server for tests closed'); });
    server.listen(port, function() {
        console.log('lively fs server for tests started');
        thenDo(null, server); });
}

function closeServer(server, thenDo) {
    server.close(thenDo);
}

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
                fsHelper.createDirStructure(baseDirectory, files, next);
            },
            function(next) {
                testRepo = new Repository({
                    fs: testDirectory,
                    excludedDirectories: ['.git', 'node_modules'],
                });
                testRepo.once('initialized', next);
            },
            function(next) {
                createServer(testRepo, function(req, res) {
                    testRepo.handleRequest(testServer, req, res);
                }, function(err, server) { testServer = server; next(err); });
            }
        ], callback);
    },
    tearDown: function (callback) {
        async.series([
            testRepo.close.bind(testRepo),
            function(next) { testServer.close(next); },
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
