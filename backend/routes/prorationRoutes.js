const express = require("express");
const router = express.Router();
const { calculateProration } = require("../controllers/prorationController");

router.post("/prorate", calculateProration);

module.exports = router;
