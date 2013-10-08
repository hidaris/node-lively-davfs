"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var async = require("async");
var path = require("path");
var fs = require("fs");
var findit = require('findit');
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
        this.rootDirectory = options.fs;
        this.versions = {};
        this.excludedDirectories = options.excludedDirectories || [];
    },

    initializeFromDisk: function(thenDo) {
        var self = this;
        async.waterfall([
            this.walkFiles.bind(this, this.excludedDirectories),
            function(findResult, next) {
                async.map(findResult.files, function(fi, next) {
                    fs.readFile(path.join(self.rootDirectory, fi.path), function(err, content) {
                        next(err, {
                            change: 'initial',
                            version: 0,
                            author: 'unknown',
                            date: '',
                            content: content.toString(),
                            fileinfo: fi
                        });
                    });
                }, next);
            },
            function(fileRecords, next) {
                fileRecords.forEach(self.addVersion.bind(self));
                next();
            },
            function(next) { self.emit('initialized'); next(); }
        ], thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // versioning
    addVersion: function(options) {
        // options = {change, version, author, date, content, fileinfo}
        var versions = this.versions[options.fileinfo.path]
                    || (this.versions[options.fileinfo.path] = []);
        // if no versionId specified we try to auto increment:
        if (options.version === undefined) {
            var lastVersion = versions[versions.length-1];
            options.version = lastVersion ? lastVersion.version + 1 : 0;
        }
        var version = {
            change: options.change, version: options.version,
            author: options.author, content: options.content,
            path: options.fileinfo.path, stat: options.fileinfo.stat,
        };
        versions.push(version);
        return version;
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessing
    getVersionsFor: function(fn, thenDo) {
        var versions = this.versions[fn] || [];
        thenDo(null, versions);
    },

    getVersions: function(thenDo) {
        var versions = Object.keys(this.versions)
            .map(function(key) { return this.versions[key]; }, this);
        thenDo(null, versions);
    },

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
