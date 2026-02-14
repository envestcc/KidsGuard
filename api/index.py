"""
Vercel Serverless entrypoint — re-exports the Flask app.
"""
import sys
import os

# Ensure the project root is on the path so imports work
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app
