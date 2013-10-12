"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var async = require("async");
var path = require("path");
var fs = require("fs");
var findit = require('findit');
var MemoryStore = require('./memory-storage');
var SQLiteStore = require('./sqlite-storage');
var importFiles = require('./file-import-task');
var lvFsUtil = require('./util');
var d = require('./domain');

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper
function isExcluded(excl, pathPart) {
    if (typeof excl === 'string' && excl === pathPart) return true;
    if (util.isRegExp(excl) && excl.test(pathPart)) return true;
    return false;
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
        this.storage = new SQLiteStore(options);
        this.rootDirectory = options.fs;
        this.excludedDirectories = options.excludedDirectories || [];
        this.excludedFiles = options.excludedFiles || [];
    },

    initializeFromDisk: function(resetDb, thenDo) {
        console.log('LivelyFS initialize at %s', this.getRootDirectory());
        var self = this, storage = this.storage;
        // Find files in root directory that should be imported and commit them
        // as a new version (change = "initial") to the storage
        async.series([
            storage.reset.bind(storage, resetDb/*drop tables?*/),
            this.readStateFromFiles.bind(this),
        ], function(err) {
            if (err) console.error('Error initializing versioned fs: %s', err);
            else self.emit('initialized');
            thenDo(err);
        });
    },

    readStateFromFiles: function(thenDo) {
        // syncs db state with what is stored on disk
        var task = importFiles(this);
        task.on('filesFound', function(files) {
            console.log('LivelyFS synching %s (%s MB) files from disk',
                files.length,
                lvFsUtil.humanReadableByteSize(lvFsUtil.sumFileSize(files)));
        });
        task.on('processBatch', function(batch) {
            console.log('Reading %s, files in batch of size %s',
                batch.length,
                lvFsUtil.humanReadableByteSize(lvFsUtil.sumFileSize(batch)));
        });
        task.on('end', thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // versioning
    createVersionRecord: function(fields, thenDo) {
        // this is what goes into storage
        var record = {
            change: fields.change || 'initial',
            version: fields.version || 0,
            author: fields.author || 'unknown',
            date: fields.date || (fields.stat && fields.stat.mtime.toISOString()) || '',
            content: fields.content ? fields.content.toString() : null,
            path: fields.path,
            stat: fields.stat
        }
        thenDo(null, record);
    },

    addVersion: function(versionData, options, thenDo) {
        this.addVersions([versionData], options, thenDo);
    },

    addVersions: function(versionDatasets, options, thenDo) {
        options = options || {};
        var versionDatasets = versionDatasets.filter(function(record) {
            return !this.isExcludedFile(record.path); }, this);
        if (!versionDatasets.length) thenDo(null);
        else this.storage.storeAll(versionDatasets, options, thenDo);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessing
    getVersionsFor: function(fn, thenDo) { this.storage.getRecordsFor(fn, thenDo); },
    getRecords: function(options, thenDo) { this.storage.getRecords(options, thenDo); },
    getFiles: function(thenDo) { this.storage.getRecords({newest: true}, thenDo); },
    getFileRecord: function(options, thenDo) {
        options = util._extend({paths: [options.path], newest: true}, options);
        this.storage.getRecords(options, function(err, rows) {
            thenDo(err, rows && rows[0]); }); 
    },

    getRootDirectory: function() { return this.rootDirectory; },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // filesystem access
    isExcludedDir: function(dirPath) {
        var sep = path.sep, dirParts = dirPath.split(sep);
        for (var i = 0; i < this.excludedDirectories.length; i++) {
            var testDir = isExcluded.bind(null,this.excludedDirectories[i]);
            if (testDir(dirPath) || dirParts.some(testDir)) return true;
        }
        return false;
    },

    isExcludedFile: function(filePath) {
        var basename = path.basename(filePath);
        for (var i = 0; i < this.excludedFiles.length; i++)
            if (isExcluded(this.excludedFiles[i], basename)) return true;
        return false;
    },

    walkFiles: function(thenDo) {
        var self = this,
            root = this.rootDirectory,
            find = findit(this.rootDirectory, {followSymlinks: true}),
            result = {files: [], directories: []},
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
