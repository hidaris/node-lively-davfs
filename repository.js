"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var livelyDAVPlugin = require('./jsDAV-plugin');
var VersionedFileSystem = require('./VersionedFileSystem');
var DavHandler = require('jsdav/lib/DAV/handler');
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
            Object.freeze(this);
            this.emit('initialized');
        }.bind(this));
        this.fs.initializeFromDisk();
    },

    close: function(thenDo) {
        this.emit('closed');
        thenDo(null);
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

    handleRequest: function(server, req, res) {
        var handler = new DavHandler(server, req, res);
    },
    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // change recording
    onFileChange: function(evt) {
        console.log('file change: ', evt.uri);
        this.fs.addVersion(undefined, 'contentChange', {path: evt.uri});
    },

    onFileCreation: function(evt) {
        console.log('file created: ', evt.uri);
        this.fs.addVersion(0, 'created', {path: evt.uri});
    },

    onFileDeletion: function(evt) {
        console.log('file deleted: ', evt.uri);
        this.fs.addVersion(undefined, 'deletion', {path: evt.uri});
    },

    // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    // accessors
    getFiles: function(thenDo) { this.fs.getFiles(thenDo); },
    getVersionsFor: function(filename, thenDo) { this.fs.getVersionsFor(filename, thenDo); },
    getVersions: function(thenDo) { this.fs.getVersions(thenDo); },

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
