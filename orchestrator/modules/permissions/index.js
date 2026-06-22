"use strict";

/**
 * Permissions bounded context — credential broker and environment parsing.
 */
module.exports = {
  ...require("./credential-broker"),
  ...require("./environment-parser"),
};
