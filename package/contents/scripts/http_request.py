#!/usr/bin/env python3

import argparse
import json
import urllib.error
import urllib.request


def to_bytes(data):
	if data is None:
		return None
	if isinstance(data, str):
		return data.encode("utf-8")
	if isinstance(data, bytes):
		return data
	return json.dumps(data).encode("utf-8")


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--payload", required=True)
	args = parser.parse_args()

	payload = json.loads(args.payload)
	url = payload["url"]
	method = payload.get("method", "GET")
	headers = payload.get("headers") or {}
	data = to_bytes(payload.get("data"))

	status = 0
	body = ""

	try:
		req = urllib.request.Request(url, data=data, headers=headers, method=method)
		with urllib.request.urlopen(req) as response:
			status = response.getcode()
			body = response.read().decode("utf-8", errors="replace")
	except urllib.error.HTTPError as err:
		status = err.code or 0
		body = err.read().decode("utf-8", errors="replace")
	except Exception as err:
		status = 0
		body = str(err)

	print(json.dumps({
		"status": status,
		"body": body,
	}))


if __name__ == "__main__":
	main()
