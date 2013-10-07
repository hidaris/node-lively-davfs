"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var async = require("async");
var path = require("path");
var findit = require('findit');
var d = require('./domain');

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// versioning data structures
/*
 * maps paths to list of versions
 * a version is {
 *   path: STRING,
 *   version: STRING||NUMBER,
 *   stat: FILESTAT,
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
        var fs = this;
        var addInitialVersion = this.addVersion.bind(this, 0, 'initial');
        this.walkFiles(this.excludedDirectories, function(err, result) {
            result.files.forEach(addInitialVersion);
            fs.emit('initialized');
            thenDo && thenDo(null);
        });
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // versioning
    addVersion: function(versionId, change, fileinfo) {
        var versions = this.versions[fileinfo.path]
                    || (this.versions[fileinfo.path] = []);
        // if no versionId specified we try to auto increment:
        if (versionId === undefined) {
            var lastVersion = versions[versions.length-1];
            versionId = lastVersion ? lastVersion.version + 1 : 0;
        }
        var version = {
            change: change, version: versionId,
            path: fileinfo.path, stat: fileinfo.stat,
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
