"use strict";

const express = require("express");
const {
  startUrl,
  callback,
  disconnect,
} = require("../controllers/google.controller.js");

const router = express.Router();

router.get("/oauth/google/app/url", startUrl);
router.get("/oauth/google/app/callback", callback);
router.post("/oauth/google/app/disconnect", disconnect);

module.exports = router;
