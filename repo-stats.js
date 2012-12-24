#!/usr/bin/env node

var async = require('async');
var colors = require('colors');
var git = require('gift');
var util = require('util');
var _ = require('lodash');

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

function compareCommitStats(a, b) {
  var diffs = [];

  if (!a) {
    Object.keys(b.stats).forEach(function (path) {
      diffs.push({
        path: path,
        diff: b.stats[path]
      });
    });

    return diffs;
  }

  var paths = _.union(Object.keys(a.stats), Object.keys(b.stats));

  paths.forEach(function (path) {
    var stats = {
      path: path,
      diff: {}
    };

    if (a.stats[path] && b.stats[path]) {
      if (_.isEqual(a.stats[path], b.stats[path])) {
        return;
      }

      Object.keys(a.stats[path]).forEach(function (key) {
        stats.diff[key] = b.stats[path][key] - a.stats[path][key];
      });
    } else if (a.stats[path]) {
      Object.keys(a.stats[path]).forEach(function (key) {
        stats.diff[key] = 0 - a.stats[path][key];
      });
    } else if (b.stats[path]) {
      Object.keys(b.stats[path]).forEach(function (key) {
        stats.diff[key] = b.stats[path][key];
      });
    }

    diffs.push(stats);
  });

  return diffs;
}

var totals = {};

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

    var previousCommitData;

    // Iterate through each commit
    async.forEachSeries(loadedCommits,
      function (commit, cbForEachCommit) {
      var tree = commit.tree();

      BLOBS = [];

      var commitData = {
        author: commit.author,
        stats: {}
      };

      // We only care about test/ right now
      tree.find('test', function (err, testTree) {
        if (err || !testTree) {
          return cbForEachCommit();
        }

        recurseTree(testTree, 'test', function () {
          var tests = BLOBS.filter(function (blob) {
            return (/test\.js$/).test(blob.path);
          });

          async.forEachSeries(tests, function (test, cbForEachTest) {
            test.blob.data(function (err, data) {
              testStats.getStats(data, function (err, stats) {
                commitData.stats[test.path] = stats;

                cbForEachTest();
              });
            });
          }, function () {
            var diffs = compareCommitStats(previousCommitData, commitData);

            diffs = diffs.filter(function (file) {
              return _.some(Object.keys(file.diff), function (key) {
                return file.diff[key] !== 0;
              });
            });

            if (diffs.length) {
              console.log(colors.green('Commit'), commitData.author.name);
              console.log(colors.red('Diff'), util.inspect(diffs));

              // Calculate totals
              if (!totals[commitData.author.name]) {
                totals[commitData.author.name] = {};
              }

              diffs.forEach(function (file) {
                Object.keys(file.diff).forEach(function (key) {
                  if (!totals[commitData.author.name][key]) {
                    totals[commitData.author.name][key] = 0;
                  }

                  totals[commitData.author.name][key] += file.diff[key];
                });
              });

              console.log(colors.grey('--------------'));
            }

            previousCommitData = commitData;

            cbForEachCommit();
          });
        });
      });
    },
    function () {
      cb();
    });
  }
], function () {
  console.log(colors.green('Totals'));
  console.log(util.inspect(totals));

  process.exit();
});
