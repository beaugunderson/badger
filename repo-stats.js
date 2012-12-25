#!/usr/bin/env node

var async = require('async');
var colors = require('colors');
var git = require('gift');
var util = require('util');
var _ = require('lodash');

var gitUtilities = require('./git-utilities');
var testStats = require('./test-stats');

if (!process.argv[2]) {
  console.log('Please specify a git repository.');

  process.exit(1);
}

var getStats = async.memoize(function (blob, cb) {
  blob.data(function (err, data) {
    testStats.getStats(data, function (err, stats) {
      cb(err, stats);
    });
  });
}, function (blob) {
  return blob.id;
});

var repo = git(process.argv[2]);

var totals = {};
var loadedCommits = [];

async.series([
  // Load all commit metadata
  function (cb) {
    var skip = 0;
    var loaded;

    async.until(function () {
      return loaded === 0;
    },
    function (cbUntil) {
      repo.commits('master', 100, skip, function (err, commits) {
        loadedCommits = loadedCommits.concat(commits);

        loaded = commits.length;
        skip += commits.length;

        cbUntil();
      });
    },
    function () {
      // Sort commits chronologically
      loadedCommits.reverse();

      cb();
    });
  },
  // Iterate through each commit
  function (cb) {
    var previousCommitData;

    async.forEachSeries(loadedCommits,
      function (commit, cbForEachCommit) {
      var tree = commit.tree();

      var commitData = {
        id: commit.id,
        author: commit.author,
        stats: {}
      };

      // We only care about test/ right now
      tree.find('test', function (err, testTree) {
        if (err || !testTree) {
          return cbForEachCommit();
        }

        gitUtilities.recurseTree(testTree, 'test', function (blobs) {
          var tests = blobs.filter(function (blob) {
            return (/test\.js$/).test(blob.path);
          });

          async.forEachSeries(tests, function (test, cbForEachTest) {
            getStats(test.blob, function (err, stats) {
              commitData.stats[test.path] = stats;

              cbForEachTest();
            });
          }, function () {
            var diffs = gitUtilities.diffCommitStats(previousCommitData,
              commitData);

            // Filter to diffs with actual changes
            diffs = diffs.filter(function (file) {
              return _.some(Object.keys(file.diff), function (key) {
                return file.diff[key] !== 0;
              });
            });

            if (diffs.length) {
              console.log(colors.green('Commit'), commitData.author.name,
                commitData.id);
              console.log(colors.red('Diff'), util.inspect(diffs));

              // Keep track of totals
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
