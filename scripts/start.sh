#!/bin/sh
# Serve Vanish for local testing on port 8083, bound to all interfaces.
# On THIS phone open http://localhost:8083 (the camera only works on localhost or https).
cd "$(dirname "$0")/.." && python3 -m http.server 8083 --bind 0.0.0.0
