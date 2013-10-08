var Repository = require('../repository'),
    path = require("path"),
    util = require("util"),
    async = require("async"),
    EventEmitter = require("events").EventEmitter,
    fsHelper = require("lively-fs-helper"),
    baseDirectory = __dirname,
    testDirectory = path.join(baseDirectory, "testDir"),
    sqlite3 = require('sqlite3').verbose(),
    dbFile = path.join(testDirectory, 'test-db.sqlite'),
    testRepo, fakeDAVPlugin, testDb;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
function logProgress(msg) {
    return function(thenDo) { console.log(msg); thenDo && thenDo(); }
}
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// db helpers
function createDB(dbLocation, thenDo) {
    testDb = new sqlite3.Database(':memory:');
    thenDo();
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// tests
var versionedFilesystemTests = {
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
            logProgress('test files created'),
            function(next) {
                fakeDAVPlugin = util._extend({}, EventEmitter.prototype);
                EventEmitter.call(fakeDAVPlugin);
                testRepo = new Repository({fs: testDirectory});
                testRepo.attachToDAVPlugin(fakeDAVPlugin);
                testRepo.start(next);
            },
            logProgress('repo setup')
        ], callback);
    },
    tearDown: function (callback) {
        async.series([
            testRepo.close.bind(testRepo),
            fsHelper.cleanupTempFiles
        ], callback);
    },
    testNewVersionOnFileChange: function(test) {
        test.expect(7);
        async.series([
            function(next) {
                fakeDAVPlugin.emit('fileChanged', {uri: 'aFile.txt'});
                next();
            },
            function(next) {
                testRepo.getVersionsFor('aFile.txt', function(err, versions) {
                    test.equal(versions.length, 2, '# versions');
                    test.equal(versions[0].version, '0', 'v1: version');
                    test.equal(versions[1].version, '1', 'v2: version');
                    next();
                });
            },
            function(next) {
                testRepo.getFileRecord({path: 'aFile.txt', version: '0'}, function(err, record) {
                    test.ok(record, 'no record');
                    test.equal(record.path, 'aFile.txt', 'path');
                    // test.equal(record.date, 'fooo?', 'date');
                    test.equal(record.author, 'unknown', 'author');
                    test.equal(record.content, 'foo bar content', 'content');
                    next();
                });
            }
        ], test.done);
    },
    // testA: function(test) {
        // test.done();
    //     test.expect(3);
    //     testRepo.getFiles(function(err, files) {
    //         test.equal(files.length, 1, '# files');
    //         test.equal(files[0].path, 'aFile.txt', 'file name');
    //         test.equal(files[0].change, 'initial', 'no change');
    //         test.done();
    //     });
    // },
    // testPutCreatesNewVersion: function(test) {
    //     test.expect(3);
    //     async.series([
    //         put.bind(null, 'aFile.txt', 'test'),
    //         function(next) {
    //             testRepo.getFiles(function(err, files) {
    //                 test.equal(files.length, 1, '# files');
    //                 test.equal(files[0].path, 'aFile.txt', 'file name');
    //                 test.equal(files[0].change, 'contentChange', 'no change recorded');
    //                 next();
    //             });
    //         }
    //     ], test.done);
    // },
    // testDeleteIsRecorded: function(test) {
    //     test.expect(5);
    //     async.series([
    //         del.bind(null, 'aFile.txt'),
    //         function(next) {
    //             testRepo.getVersionsFor('aFile.txt', function(err, versions) {
    //                 test.equal(versions.length, 2, '# versions');
    //                 test.equal(versions[0].path, 'aFile.txt', 'v1: path');
    //                 test.equal(versions[0].change, 'initial', 'v1: change');
    //                 test.equal(versions[1].path, 'aFile.txt', 'v2: path');
    //                 test.equal(versions[1].change, 'deletion', 'v2: change');
    //                 next();
    //             });
    //         }
    //     ], test.done);
    // },
    // testDAVCreatedFileIsFound: function(test) {
    //     test.expect(4);
    //     async.series([
    //         put.bind(null, 'writtenFile.txt', 'test'),
    //         function(next) {
    //             testRepo.getFiles(function(err, files) {
    //                 test.equal(files.length, 2, '# files');
    //                 test.equal(files[0].path, 'aFile.txt', 'file name');
    //                 test.equal(files[1].path, 'writtenFile.txt', 'file name 2');
    //                 test.equal(files[1].change, 'created', 'file 2 change');
    //                 next();
    //             });
    //         }
    //     ], test.done);
    // },
};

module.exports = versionedFilesystemTests;
