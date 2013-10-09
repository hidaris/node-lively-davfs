"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var async = require("async");
var path = require("path");
var fs = require("fs");
var findit = require('findit');
var MemoryStore = require('./memory-storage');
var SQLiteStore = require('./sqlite-storage');
var d = require('./domain');

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper
function batchify(list, constrainedFunc, context) {
    // takes elements and fits them into subarrays (=batches) so that for
    // each batch constrainedFunc returns true. Note that contrained func
    // should at least produce 1-length batches, otherwise an error is raised
    // see [$world.browseCode("lively.lang.tests.ExtensionTests.ArrayTest", "testBatchify", "lively.lang.tests.ExtensionTests")]
    // for an example
    function extractBatch(batch, sizes) {
        // Array -> Array -> Array[Array,Array]
        // case 1: no sizes to distribute, we are done
        if (!sizes.length) return [batch, []];
        var first = sizes[0], rest = sizes.slice(1);
        // if batch is empty we have to take at least one
        // if batch and first still fits, add first
        var candidate = batch.concat([first]);
        if (constrainedFunc.call(context, candidate)) return extractBatch(candidate, rest);
        // otherwise leave first out for now
        var batchAndSizes = extractBatch(batch, rest);
        return [batchAndSizes[0], [first].concat(batchAndSizes[1])];
    }
    function findBatches(batches, sizes) {
        if (!sizes.length) return batches;
        var extracted = extractBatch([], sizes);
        if (!extracted[0].length)
            throw new Error('Batchify constrained does not ensure consumption '
                          + 'of at least one item per batch!');
        return findBatches(batches.concat([extracted[0]]), extracted[1]);
    }
    return findBatches([], list);
}

function sum(arr) { return arr.reduce(function(sum,ea) { return sum+ea; },0); }

function pluck(arr, property) {
    var result = new Array(arr.length);
    for (var i = 0; i < arr.length; i++) {
        result[i] = arr[i][property]; }
    return result;
}

function humanReadableByteSize(n) {
    function round(n) { return Math.round(n * 100) / 100 }
    if (n < 1000) return String(round(n)) + 'B'
    n = n / 1024;
    if (n < 1000) return String(round(n)) + 'KB'
    n = n / 1024;
    return String(round(n)) + 'MB'
}
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// versioning data structures
/*
 * maps paths to list of versions
 * a version is {
 *   path: STRING,
 *   version: STRING||NUMBER,
 *   [stat: FILESTAT,]
 *   author: STRING,
 *   date: STRING,
 *   content: STRING,
 *   change: STRING
 * }
 * a change is what kind of operation the version created:
 * ['initial', 'creation', 'deletion', 'contentChange']
 */
 
function VersionedFileSystem(options) {
    try {
        EventEmitter.call(this);
        this.initialize(options);
    } catch(e) { this.emit('error', e); }
}

util._extend(VersionedFileSystem.prototype, EventEmitter.prototype);

util._extend(VersionedFileSystem.prototype, d.bindMethods({

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // initializing
    initialize: function(options) {
        if (!options.fs) this.emit('error', 'VersionedFileSystem needs location!');
        this.storage = new SQLiteStore();
        // this.storage = new MemoryStore();
        this.rootDirectory = options.fs;
        this.excludedDirectories = options.excludedDirectories || [];
        this.excludedFiles = options.excludedFiles || [];
    },

    initializeFromDisk: function(resetDb, thenDo) {
        console.log('LivelyFS initialize at %s', this.getRootDirectory());
        if (!resetDb) {
            var self = this;
            self.storage.reset(false, function(err) {
                if (!err) self.emit('initialized');
                thenDo(err); 
            });
            return;
        }

        var self = this;
        async.waterfall([
            function(next) { self.storage.reset(true, next); },
            self.walkFiles.bind(self, self.excludedDirectories, self.excludedFiles),
            function(findResult, next) {
                var batchMaxSize = 40, batchMaxFileSize = Math.pow(2, 26)/*64MB*/
                function sumFileSize(batch) { return sum(pluck(pluck(batch, 'stat'), 'size')); }
                var fileReadBatches = batchify(findResult.files, function(batch) {
                    return batch.length == 1
                        || batch.length < batch.length
                        || sumFileSize(batch) < batchMaxFileSize; })
                console.log('LivelyFS initialize synching %s files (%s MB) in %s batches (%s)',
                    findResult.files.length,
                    humanReadableByteSize(sumFileSize(findResult.files)),
                    fileReadBatches.length,
                    fileReadBatches.map(function(batch) { return humanReadableByteSize(sumFileSize(batch)); }).join(', '));
                function createRecordForFileInfo(fi, thenDo) {
                    fs.readFile(path.join(self.rootDirectory, fi.path), function(err, content) {
                        if (err) { console.log('error reading file %s:', fi.path, err); thenDo(err); return; }
                        thenDo(err, {
                            change: 'initial',
                            version: 0,
                            author: 'unknown',
                            date: fi.stat ? fi.stat.mtime.toISOString() : '',
                            content: content && content.toString(),
                            path: fi.path,
                            stat: fi.stat
                        });
                    });
                }

async.forEachSeries(fileReadBatches, function(batch, next) {
    console.log('Reading %s, files in batch of size %s', batch.length, humanReadableByteSize(sumFileSize(batch)));
    async.waterfall([
        async.mapSeries.bind(async, batch, createRecordForFileInfo),
        function(fileRecords, next) { self.addVersions(fileRecords, next); }
    ], next);
}, next);
                
//                 async.forEachSeries(fileReadBatches, function(batch, next) {
// console.log('Reading %s, files in batch of size %s', batch.length, humanReadableByteSize(sumFileSize(batch)));
//                     async.waterfall([
//                         async.map.bind(async, batch, createRecordForFileInfo),
//                         function(fileRecords, next) { self.addVersions(fileRecords, next); }
//                     ], next);
//                 }, next);
            },
            function(next) { self.emit('initialized'); next(); }
        ], thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // versioning
    _excludeTest: function(excl, pathPart) {
        if (typeof excl === 'string' && excl === pathPart) return true;
        if (util.isRegExp(excl) && excl.test(pathPart)) return true;
        return false;
    },
    isExcludedDir: function(dirPath) {
        var sep = path.sep, dirParts = dirPath.split(sep);
        for (var i = 0; i < this.excludedDirectories.length; i++) {
            var testDir = this._excludeTest.bind(null,this.excludedDirectories[i]);
            if (testDir(dirPath) || dirParts.some(testDir)) return true;
        }
        return false;
    },
    isExcludedFile: function(filePath) {
        var basename = path.basename(filePath);
        for (var i = 0; i < this.excludedFiles.length; i++)
            if (this._excludeTest(this.excludedFiles[i], basename)) return true;
        return false;
    },
    addVersion: function(versionData, thenDo) {
        // options = {change, version, author, date, content, path}
        if (this.isExcludedFile(versionData.path)) thenDo(null)
        else this.storage.store(versionData, thenDo);
    },
    addVersions: function(versionDatasets, thenDo) {
        var versionDatasets = versionDatasets.filter(function(record) {
            return !this.isExcludedFile(record.path); }, this);
        if (!versionDatasets.length) thenDo(null);
        else this.storage.storeAll(versionDatasets, thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessing
    getVersionsFor: function(fn, thenDo) { this.storage.getVersionsFor(fn, thenDo); },
    getVersions: function(thenDo) { this.storage.dump(thenDo); },
    getFiles: function(thenDo) {
        this.getVersions(function(err, versions) {
            if (err) { thenDo(err); return; }
            var existingFiles = versions
                .map(function(fileVersions) {
                    return fileVersions[fileVersions.length-1]; })
                .filter(function(version) {
                    return version && version.change !== 'deletion'; });
            thenDo(null, existingFiles);
        });
    },

    getFileRecord: function(options, thenDo) {
        var errMsg;
        if (!options.path) errMsg = 'No path specified';
        if (!errMsg && !options.version) errMsg = 'No version specified';
        if (errMsg) { thenDo(errMsg); return; }
        var fs = this;
        this.getVersionsFor(options.path, function(err, versions) {
            if (err || !versions) { thenDo(err, null); return; }
            var records = versions.filter(function(v) {
                return String(v.version) === String(options.version); });
            thenDo(null, records && records[0]);
        });
    },

    getRootDirectory: function() { return this.rootDirectory; },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // filesystem access
    walkFiles: function(excludedDirs, excludedFiles, thenDo) {
        var self = this,
            root = this.rootDirectory,
            find = findit(this.rootDirectory),
            result = {files: [], directories: []},
            ignoredDirs = excludedDirs || [],
            // ignoredFiles = excludedFiles || [],
            ended = false;
        find.on('directory', function (dir, stat, stop) {
            var relPath = path.relative(root, dir);
            result.directories.push({path: relPath, stat: stat});
            var base = path.basename(relPath);
            if (self.isExcludedDir(base)) stop();
        });
        find.on('file', function (file, stat) {
            var relPath = path.relative(root, file);
            if (self.isExcludedFile(relPath)) return;
            result.files.push({path: relPath,stat: stat});
        });
        find.on('link', function (link, stat) {});
        var done = false;
        function onEnd() {
            if (done) return;
            done = true; thenDo(null, result);
        }
        find.on('end', onEnd);
        find.on('stop', onEnd);
    }
}));

module.exports = VersionedFileSystem;
