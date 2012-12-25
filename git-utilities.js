var async = require('async');
var _ = require('lodash');

exports.recurseTree = function (start, path, cb) {
  var result = [];

  async.series([
    // Get an array of blobs wrapped with the path
    function (cbSeries) {
      if (!start.blobs) {
        return cbSeries();
      }

      start.blobs(function (err, blobs) {
        blobs.forEach(function (blob) {
          result.push({
            path: path + '/' + blob.name,
            blob: blob
          });
        });

        cbSeries();
      });
    },
    // Recurse into each subtree and get its blobs too
    function (cbSeries) {
      if (!start.trees) {
        return cbSeries();
      }

      start.trees(function (err, trees) {
        async.forEachSeries(trees, function (tree, cbForEach) {
          exports.recurseTree(tree, path + '/' + tree.name,
            function (subResult) {
            result = result.concat(subResult);

            cbForEach();
          });
        }, function () {
          cbSeries();
        });
      });
    }
  ], function () {
    cb(result);
  });
};

exports.diffCommitStats = function (a, b) {
  var diffs = [];

  var paths = _.union(
    a ? Object.keys(a.stats) : [],
    b ? Object.keys(b.stats) : []
  );

  paths.forEach(function (path) {
    var stats = {
      path: path,
      diff: {}
    };

    if (a && b && a.stats && b.stats && a.stats[path] && b.stats[path]) {
      if (_.isEqual(a.stats[path], b.stats[path])) {
        return;
      }

      Object.keys(a.stats[path]).forEach(function (key) {
        stats.diff[key] = b.stats[path][key] - a.stats[path][key];
      });
    } else if (a && a.stats && a.stats[path]) {
      Object.keys(a.stats[path]).forEach(function (key) {
        stats.diff[key] = 0 - a.stats[path][key];
      });
    } else if (b && b.stats && b.stats[path]) {
      Object.keys(b.stats[path]).forEach(function (key) {
        stats.diff[key] = b.stats[path][key];
      });
    }

    diffs.push(stats);
  });

  return diffs;
};
