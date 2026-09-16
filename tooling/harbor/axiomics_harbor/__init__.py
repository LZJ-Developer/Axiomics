"""Axiomics as a Harbor / Terminal-Bench installed agent.

``axiomics_harbor.agent:AxiomicsAgent`` installs the pinned Axiomics
release into the task container, runs ``axiomics run --format json
--auto-approve`` against the task instruction, and converts the JSON event
stream into an ATIF trajectory. ``axiomics_harbor.trajectory`` holds the
dependency-free converter so it can be tested without Harbor installed.
"""
