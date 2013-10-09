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
            self.walkFiles.bind(self, self.excludedDirectories),
            function(findResult, next) {
                console.log('LivelyFS initialize synching %s files', findResult.files.length);
                async.map(findResult.files, function(fi, next) {
                    var bypassContentRead = false;
                    if (bypassContentRead) {
                        next(null, {
                            change: 'initial',
                            version: 0,
                            author: 'unknown',
                            date: fi.stat ? fi.stat.mtime.toISOString() : '',
                            content: null,
                            path: fi.path,
                            stat: fi.stat
                        });
                    } else {
                        fs.readFile(path.join(self.rootDirectory, fi.path), function(err, content) {
                            next(err, {
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
                }, next);
            },
            function(fileRecords, next) {
                self.addVersions(fileRecords, function(err) { next(err); });
            },
            function(next) { self.emit('initialized'); next(); }
        ], thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // versioning
    addVersion: function(versionData, thenDo) {
        // options = {change, version, author, date, content, path}
        this.storage.store(versionData, thenDo);
    },
    addVersions: function(versionDatasets, thenDo) {
        this.storage.storeAll(versionDatasets, thenDo);
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
    walkFiles: function(excludedDirs, thenDo) {
        var root = this.rootDirectory,
            find = findit(this.rootDirectory),
            result = {files: [], directories: []},
            ignoredDirs = excludedDirs || [],
            ended = false;
        find.on('directory', function (dir, stat, stop) {
            var base = path.basename(dir);
            result.directories.push({path: dir, stat: stat});
            if (ignoredDirs.indexOf(base) >= 0) stop();
        });
        find.on('file', function (file, stat) {
            // !FIXME!
            if (file.indexOf('.sqlite') >= 0) return;
            result.files.push({
                path: path.relative(root, file),
                stat: stat
            });
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
