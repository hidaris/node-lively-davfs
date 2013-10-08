"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var livelyDAVPlugin = require('./jsDAV-plugin');
var VersionedFileSystem = require('./VersionedFileSystem');
var d = require('./domain');

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging
global.dir = function(obj, depth) {
    console.log(util.inspect(obj, {depth: depth || 0}));
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// Repo
function Repository(options) {
    try {
        EventEmitter.call(this);
        this.initialize(options);
    } catch(e) { this.emit('error', e); }
}

util._extend(Repository.prototype, EventEmitter.prototype);

util._extend(Repository.prototype, d.bindMethods({

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // intialize-release
    initialize: function(options) {
        this.fs = new VersionedFileSystem(options);
        this.fs.once('initialized', function() {
            this.emit('initialized');
        }.bind(this));
        Object.freeze(this);
    },

    start: function(thenDo) {
        this.fs.initializeFromDisk(thenDo);
    },

    close: function(thenDo) {
        this.emit('closed');
        thenDo && thenDo(null);
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // DAV
    getDAVPlugin: function() {
        return livelyDAVPlugin.onNew(this.attachToDAVPlugin.bind(this));
    },
    attachToDAVPlugin: function(plugin) {
        plugin.on('fileChanged', this.onFileChange.bind(this));
        plugin.on('fileCreated', this.onFileCreation.bind(this));
        plugin.on('fileDeleted', this.onFileDeletion.bind(this));
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change recording
    onFileChange: function(evt) {
        console.log('file change: ', evt.uri);
        this.fs.addVersion({
            version: undefined,
            change: 'contentChange',
            author: 'unknown',
            date: '',
            content: null,
            fileinfo: {path: evt.uri}
        });
    },

    onFileCreation: function(evt) {
        console.log('file created: ', evt.uri);
        this.fs.addVersion({
            version: 0,
            change: 'created',
            author: 'unknown',
            date: '',
            content: null,
            fileinfo: {path: evt.uri}
        });
    },

    onFileDeletion: function(evt) {
        console.log('file deleted: ', evt.uri);
        this.fs.addVersion({
            version: undefined,
            change: 'deletion',
            author: 'unknown',
            date: '',
            content: null,
            fileinfo: {path: evt.uri}
        });
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessors
    getFiles: function(thenDo) { this.fs.getFiles(thenDo); },
    getVersionsFor: function(filename, thenDo) { this.fs.getVersionsFor(filename, thenDo); },
    getVersions: function(thenDo) { this.fs.getVersions(thenDo); },
    getRootDirectory: function() { return this.fs.getRootDirectory(); },
    getFileRecord: function(options, thenDo) { return this.fs.getFileRecord(options, thenDo); },
    
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // debugging
    logState: function() {
        console.log('log repo state:');
        console.log("versionedFileInfos: ");
        dir(this.fs, 1);
    }
}));


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports
module.exports = Repository;
