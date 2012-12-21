#!/usr/bin/env node

var esprima = require('esprima');
var _ = require('underscore');

// Executes visitor on the object and its children (recursively).
function traverse(object, visitor) {
  var key, child;

  visitor.call(null, object);

  for (key in object) {
    if (object.hasOwnProperty(key)) {
      child = object[key];

      if (typeof child === 'object' && child !== null) {
        traverse(child, visitor);
      }
    }
  }
}

var report;

function binaryExpressionToString(expression) {
  return _.map([expression.left, expression.right], function (part) {
    if (part.type === 'Literal') {
      return part.value;
    }

    if (part.type === 'Identifier') {
      return part.name;
    }

    if (part.type === 'BinaryExpression') {
      return binaryExpressionToString(part);
    }
  }).join('');
}

function checkTest(node) {
  if (!node.expression.callee) {
    return;
  }

  var args = node.expression['arguments'];

  if (!args || !args.length) {
    return;
  }

  var name;

  if (args[0].type === 'BinaryExpression') {
    name = binaryExpressionToString(args[0]);
  } else {
    name = args[0].value;
  }

  if (node.expression.callee.name === 'it') {
    if (args.length === 1) {
      report('stub');
    } else if (args.length > 1) {
      if (args[1].params[0] && args[1].params[0].type === 'Identifier') {
        return report('test-async');
      }

      report('test');
    }
  }
}

exports.getStats = function (content, cb) {
  var syntax = esprima.parse(content, {
    tolerant: true,
    loc: true,
    range: true
  });

  var stats = {};

  report = function (type) {
    if (!stats[type]) {
      stats[type] = 0;
    }

    stats[type]++;
  };

  traverse(syntax, function (node) {
    if (node.type === 'ExpressionStatement') {
      checkTest(node);
    }
  });

  cb(null, stats);
};
