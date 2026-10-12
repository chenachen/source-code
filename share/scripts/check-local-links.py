#!/usr/bin/env python3
"""Check local share HTML targets and IDs; not a browser or remote URL audit."""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import sys


class Links(HTMLParser):
    """Collect real href/src attributes and IDs, excluding code text."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.ids = []
        self.targets = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            self.ids.append(attrs['id'])
        for key in ('href', 'src'):
            if attrs.get(key):
                self.targets.append(attrs[key])

    handle_startendtag = handle_starttag


def main():
    """Validate every share HTML page relative to its own directory."""
    root = Path(__file__).resolve().parents[1]
    pages = sorted(root.rglob('*.html'))
    parsed = {p.resolve(): Links(p.read_text(encoding='utf-8')) for p in pages}
    errors = []
    count = 0
    for page, data in parsed.items():
        for ident, occurrences in Counter(data.ids).items():
            if occurrences > 1:
                errors.append(f'{page.relative_to(root)}: duplicate id {ident}')
        for href in data.targets:
            url = urlsplit(href)
            if url.scheme or url.netloc:
                continue
            count += 1
            target = (page.parent / unquote(url.path)).resolve() if url.path else page
            if not target.exists():
                errors.append(f'{page.relative_to(root)}: missing {href}')
            elif url.fragment and target.suffix.lower() == '.html':
                if target not in parsed:
                    parsed_target = Links(target.read_text(encoding='utf-8'))
                else:
                    parsed_target = parsed[target]
                if unquote(url.fragment) not in parsed_target.ids:
                    errors.append(f'{page.relative_to(root)}: missing anchor {href}')
    for error in errors:
        print(error)
    print(f'{len(pages)} HTML pages, {count} local references, {len(errors)} errors')
    return bool(errors)


if __name__ == '__main__':
    sys.exit(main())
