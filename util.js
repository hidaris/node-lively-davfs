"use strict"

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

function sumFileSize(objsWithFilestats) { 
    /**/
    return sum(pluck(pluck(objsWithFilestats, 'stat'), 'size'));
}

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

module.exports = {
    batchify: batchify,
    sum: sum,
    sumFileSize: sumFileSize,
    pluck: pluck,
    humanReadableByteSize: humanReadableByteSize
}
