#!/usr/bin/env python3
"""Dev server: like `python3 -m http.server`, but tells the browser not to cache,
so edited JS modules are always reloaded. Usage: python3 tools/serve.py [port]"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
