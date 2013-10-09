"use strict"

var util = require("util");
var EventEmitter = require("events").EventEmitter;
var d = require('./domain');

function MemoryStore() {
    this.versions = null;
    EventEmitter.call(this);
}

util._extend(MemoryStore.prototype, EventEmitter.prototype);

util._extend(MemoryStore.prototype, d.bindMethods({

    reset: function(thenDo) { this.versions = {}; thenDo && thenDo(null); },

    store: function(versionData, thenDo) {
        var versions = this.versions[versionData.path]
                    || (this.versions[versionData.path] = []);
        // if no versionId specified we try to auto increment:
        if (versionData.version === undefined) {
            var lastVersion = versions[versions.length-1];
            versionData.version = lastVersion ? lastVersion.version + 1 : 0;
        }
        var version = {
            change: versionData.change, version: versionData.version,
            author: versionData.author, content: versionData.content,
            date: versionData.date, path: versionData.path, stat: versionData.stat,
        };
        versions.push(version);
        thenDo && thenDo(null, version)
    },

    storeAll: function(versionDataSets, thenDo) {
        versionDataSets.forEach(function(versionData) {
            this.store(versionData); }, this);
        thenDo(null);
    },

    getVersionsFor: function(fn, thenDo) {
        thenDo(null, this.versions[fn] || []);
    },

    dump: function(thenDo) { // get all versions
        var versions = this.versions;
        thenDo(null, Object.keys(versions).map(function(key) {
            return versions[key]; }));
    }

}));

module.exports = MemoryStore;
