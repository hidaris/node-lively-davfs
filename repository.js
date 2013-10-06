var path = require("path");
var jsDAV = require(path.join("jsdav/lib/jsdav"));
// var jsDAV_Server = require("jsdav/lib/DAV/server");
var findit = require('findit');

function startDAV(fsPath, port, thenDo) {
    var davServer = jsDAV.createServer({
        node: fsPath || process.cwd(),
        plugins: {}}, port);
// plugins: jsDAV_Util.extend(jsDAV_Server.DEFAULT_PLUGINS, {
//         "cors": require("./cors")
//     }
    davServer.once('listening', function() {
        thenDo(null, davServer);
    });
}

function createRepository(options, thenDo) {
    if (!options.fs) options.fs = process.cwd();
    if (!options.port) options.port = 9032;
    startDAV(options.fs, options.port, function(err, server) {
        if (err) { thenDo(err); return }
        thenDo(null, new Repository({
            davServer: server,
            port: options.port,
            fs: options.fs
        }));
    });
}

function removeRepository(repo, thenDo) {
    if (repo.davServer) {
        repo.davServer.close(function() {
            console.log('closed dav server');
            thenDo(null);
        });
    } else {
        thenDo(null);
    }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function Repository(options) {
    this.davServer = options.davServer;
    this.port = options.port;
    this.fs = options.fs;
    this.fileList = [];
    Object.freeze(this);
}

(function() {
    this.listFiles = function(thenDo) {
        var root = this.fs,
            find = findit(this.fs),
            files = [];
        find.on('directory', function (dir, stat, stop) {
            var base = path.basename(dir);
            if (base === '.git' || base === 'node_modules') stop();
            // else console.log(dir + '/')
        });
        find.on('file', function (file, stat) {
            files.push({path: path.relative(root, file), stat: stat});
        });
        find.on('link', function (link, stat) {});
        find.on('end', function() { thenDo(null, files); });
        // finder.on('stop', function () {})
    }
}).call(Repository.prototype);

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// exports

module.exports = {
    createRepository: createRepository,
    removeRepository: removeRepository
}
