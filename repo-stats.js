#!/usr/bin/env node

var async = require('async');
var git = require('gift');

var testStats = require('./test-stats');

if (!process.argv[2]) {
  console.log('Please specify a git repository.');

  process.exit(1);
}

var repo = git(process.argv[2]);

var LIMIT = 100;

var skip = 0;
var loaded;

var loadedCommits = [];

var BLOBS = [];

function recurseTree(start, path, cb) {
  async.series([
    function (cbSeries) {
      if (!start.blobs) {
        return cbSeries();
      }

      start.blobs(function (err, blobs) {
        blobs.forEach(function (blob) {
          BLOBS.push({
            path: path + '/' + blob.name,
            blob: blob
          });
        });

        cbSeries();
      });
    },
    function (cbSeries) {
      if (!start.trees) {
        return cbSeries();
      }

      start.trees(function (err, trees) {
        async.forEachSeries(trees, function (tree, cbForEach) {
          recurseTree(tree, path + '/' + tree.name, cbForEach);
        }, function () {
          cbSeries();
        });
      });
    }
  ], function () {
    cb();
  });
}

async.series([
  function (cb) {
    async.until(function () {
      return loaded === 0;
    },
    function (cbUntil) {
      repo.commits('master', LIMIT, skip, function (err, commits) {
        loadedCommits = loadedCommits.concat(commits);

        loaded = commits.length;
        skip += commits.length;

        cbUntil();
      });
    },
    function () {
      cb();
    });
  },
  function (cb) {
    // Sort commits chronologically
    loadedCommits.reverse();

    // Iterate through each commit
    async.forEachSeries(loadedCommits,
      function (commit, cbForEach) {
      var tree = commit.tree();

      BLOBS = [];

      // We only care about test/ right now
      tree.find('test', function (err, testTree) {
        if (err || !testTree) {
          return cbForEach();
        }

        recurseTree(testTree, 'test', function () {
          var tests = BLOBS.filter(function (blob) {
            return (/test\.js$/).test(blob.path);
          });

          tests.forEach(function (test) {
            test.blob.data(function (err, data) {
              testStats.getStats(data, function (err, stats) {
                // Here's where we can generate per-commit stats for each author
                // by diffing the stats.
                console.log(test.path, stats);
              });
            });
          });

          console.log('------------');

          cbForEach();
        });
      });
    },
    function () {
      cb();
    });
  }
], function () {
  process.exit();
});
