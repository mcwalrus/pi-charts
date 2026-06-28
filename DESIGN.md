
I want to create a pi.dev harness extension which allows you to run sidecarts when you startup your pi harness. The idea is that it might run some bash, python, or javascript script at the time of startup which could be useful for some other extension to your harness.

Design criteria / considerations:

- How does the figuration place under `.pi/` folder? e.g `picarts/config.json`
- Where are logs handled, how are warnings and exit statuses shown.
- Is there existing frameworks to consider. E.g vscode handling before script runs.

* This is designed to be lightweight
* For now, I would like to be able to run a kubectl portforward.
* How the shell is involved which can maintain local shell configuration
* For my case, do I need to consider a health-check / readiness probe.
* How should this affect pi harness

Consider these points and write to a file CONSIDERATIONS.md

~~I will review.~~ Reviewed. LGTM, my thoughts:

1. **Config location:** Use `.pi/picarts.json`
2. **Auto-restart on crash:** Skip for v1
3. **Health checks:** Include simple TCP check
4. **PID files:** Ignore orphans initially
5. **Global sidecarts:** Ignore for now
6. **`/picarts` command scope:** list/restart/stop/start/status

Considering this, draft a SPECIFICATION.md document.

Add a final consideration for how failed sidecarts can be notify the UI on startup.

It would be good to know:
- [ ] Picarts are started. 
- [ ] Picarts have failed. Where are the logs found. 

Include a README.md and move specification to docs/SPECIFICATION.md

Build the pi-extension, include testing via libraries if possible. 

Prepare for presentation.