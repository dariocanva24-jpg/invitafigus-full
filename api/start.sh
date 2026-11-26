#!/bin/bash
set -e
echo "Installing dependencies..."
npm install --omit=dev
echo "Starting server..."
node server.js
