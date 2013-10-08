var Repository = require('../repository'),
    livelyDAVHandler = require('../request-handler'),
    path = require("path"),
    async = require("async"),
    request = require("request"),
    http = require("http"),
    fsHelper = require("lively-fs-helper"),
    port = 9009, testRepo, testServer, handler,
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir");

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
    return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// test server
function createServer(thenDo) {
    var server = testServer = http.createServer();
    server.on('close', function() { console.log('lively fs server for tests closed'); });
    server.listen(port, function() {
        console.log('lively fs server for tests started');
        thenDo(null, server); });
}

function closeServer(server, thenDo) {
    server.close(thenDo);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// request helpers
function put(path, content, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request.put(url, {body: content}, function(err, res) {
        console.log('PUT done'); thenDo && thenDo(err); });
}
function del(path, thenDo) {
    var url = 'http://localhost:' + port + '/' + (path || '');
    request(url, {method: 'DELETE'}, function(err, res) {
        console.log('DELETE done'); thenDo && thenDo(err); });
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// tests
var tests = {
    setUp: function (callback) {
        async.series([
            function(next) {
                var files = {
                    "testDir": {"aFile.txt": 'foo bar content'}
                };
                fsHelper.createDirStructure(baseDirectory, files, next);
            },
            logProgress('test files created'),
            createServer,
            logProgress('server created'),
            function(next) {
                handler = new livelyDAVHandler({fs: testDirectory});
                testRepo = handler.repository;
                testServer.on('request', function(req, res, next) {
                    handler.handleRequest(req, res, next);
                });
                handler.registerWith(null, testServer, next)
            },
            logProgress('handler setup')
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
            function(next) {
                put('aFile.txt', 'test');
                testRepo.once('synchronized', next);
            },
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
            function(next) { del('aFile.txt'); testRepo.once('synchronized', next); },
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
            function(next) { put('writtenFile.txt', 'test'); testRepo.once('synchronized', next); },
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
    }
};

module.exports = tests;
