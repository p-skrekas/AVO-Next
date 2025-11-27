import os
import sys
import json
import requests
from dotenv import load_dotenv
from google.oauth2 import service_account
from google.auth.transport.requests import Request

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv()

# Vertex AI configuration
SERVICE_ACCOUNT_FILE = "service-account.json"
PROJECT_ID = "mouhalis-voice-order"
LOCATION = "us-central1"
MODEL_ID = "gemini-2.5-pro" 


def get_access_token():
    """Get access token from service account credentials"""
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
    credentials.refresh(Request())
    return credentials.token


def test_streaming_structured():
    """Test streaming with structured output using REST API"""

    # Define the schema for structured output
    schema = {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "The title of the story"
            },
            "author": {
                "type": "string",
                "description": "The author's name (fictional)"
            },
            "genre": {
                "type": "string",
                "description": "The genre of the story"
            },
            "word_count": {
                "type": "integer",
                "description": "Approximate word count"
            },
            "story": {
                "type": "string",
                "description": "The full story text (this should be long and detailed)"
            },
            "summary": {
                "type": "string",
                "description": "A brief summary"
            },
            "themes": {
                "type": "array",
                "items": {
                    "type": "string"
                },
                "description": "List of main themes"
            }
        },
        "required": ["title", "author", "genre", "word_count", "story", "summary", "themes"]
    }

    # Test prompt
    prompt = """Γράψε μια μεγάλη ιστορία επιστημονικής φαντασίας στα ελληνικά για την τεχνητή νοημοσύνη.
    Η ιστορία πρέπει να είναι τουλάχιστον 500 λέξεις."""

    print("Testing Structured Output Streaming with Gemini 2.5 Pro (REST API)")
    print("=" * 60)
    print()

    # Get access token
    access_token = get_access_token()

    # Build the REST API URL
    url = f"https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}:streamGenerateContent"

    # Build the request payload
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.7,
            "responseMimeType": "application/json",
            "responseSchema": schema
        }
    }

    # Set headers
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    print(f"Making REST API call to: {url}")
    print()

    try:
        # Make streaming request
        response = requests.post(
            url,
            headers=headers,
            json=payload,
            stream=True
        )

        # Check response status
        response.raise_for_status()

        # Accumulate the JSON as it streams
        full_json = ""
        chunk_count = 0
        accumulated_text = ""

        print("Streaming JSON response chunks:")
        print("-" * 60)

        # Buffer for accumulating response data
        buffer = ""

        # Process streaming response
        for chunk in response.iter_content(chunk_size=None, decode_unicode=True):
            if not chunk:
                continue

            buffer += chunk

            # Try to parse complete JSON objects from buffer
            # The response comes as array of JSON objects separated by commas and newlines
            while True:
                # Try to find a complete JSON object
                try:
                    # Look for pattern like {...} or [{...}]
                    # First, clean up the buffer
                    buffer = buffer.strip()

                    # Skip array opening bracket
                    if buffer.startswith('['):
                        buffer = buffer[1:].strip()

                    # Skip commas between objects
                    if buffer.startswith(','):
                        buffer = buffer[1:].strip()

                    # Skip array closing bracket at the end
                    if buffer == ']':
                        buffer = ""
                        break

                    # If buffer is empty, break
                    if not buffer:
                        break

                    # Try to find end of JSON object
                    brace_count = 0
                    end_index = -1
                    in_string = False
                    escape_next = False

                    for i, char in enumerate(buffer):
                        if escape_next:
                            escape_next = False
                            continue

                        if char == '\\':
                            escape_next = True
                            continue

                        if char == '"' and not escape_next:
                            in_string = not in_string
                            continue

                        if not in_string:
                            if char == '{':
                                brace_count += 1
                            elif char == '}':
                                brace_count -= 1
                                if brace_count == 0:
                                    end_index = i + 1
                                    break

                    # If we found a complete object
                    if end_index > 0:
                        json_str = buffer[:end_index]
                        buffer = buffer[end_index:].strip()

                        # Parse the JSON object
                        chunk_data = json.loads(json_str)
                        chunk_count += 1

                        # Extract text from the chunk
                        if 'candidates' in chunk_data and len(chunk_data['candidates']) > 0:
                            candidate = chunk_data['candidates'][0]

                            # Check for content
                            if 'content' in candidate and 'parts' in candidate['content']:
                                for part in candidate['content']['parts']:
                                    if 'text' in part:
                                        text_chunk = part['text']
                                        accumulated_text += text_chunk

                                        print(f"\n[Chunk {chunk_count}] {len(text_chunk)} chars")
                                        # Show preview of chunk
                                        preview = text_chunk[:200] if len(text_chunk) > 200 else text_chunk
                                        print(preview)

                                        # Try to parse accumulated JSON to detect story field
                                        try:
                                            partial_data = json.loads(accumulated_text)
                                            if 'story' in partial_data:
                                                story_len = len(partial_data['story'])
                                                print(f"[STORY FIELD] {story_len} chars accumulated")
                                        except json.JSONDecodeError:
                                            # JSON not complete yet
                                            pass

                            # Check for finish reason
                            if 'finishReason' in candidate:
                                print(f"\n[DEBUG] Finish reason: {candidate['finishReason']}")
                    else:
                        # No complete object found, wait for more data
                        break

                except json.JSONDecodeError:
                    # Not enough data yet, wait for more
                    break
                except Exception as e:
                    print(f"[WARNING] Error parsing chunk: {e}")
                    # Skip to next potential object
                    if '{' in buffer[1:]:
                        buffer = buffer[buffer.index('{', 1):]
                    else:
                        break

        print("\n" + "=" * 60)
        print("Streaming completed!")
        print(f"Total chunks received: {chunk_count}")
        print(f"Total accumulated characters: {len(accumulated_text)}")

        # Parse the complete JSON
        try:
            data = json.loads(accumulated_text)
            print("\n" + "=" * 60)
            print("PARSED STRUCTURED OUTPUT:")
            print("=" * 60)
            print(f"Title: {data.get('title', 'N/A')}")
            print(f"Author: {data.get('author', 'N/A')}")
            print(f"Genre: {data.get('genre', 'N/A')}")
            print(f"Word Count: {data.get('word_count', 'N/A')}")
            print(f"Summary: {data.get('summary', 'N/A')}")
            print(f"Themes: {data.get('themes', [])}")
            print(f"\nStory Length: {len(data.get('story', ''))} characters")
            print("\nFirst 500 characters of story:")
            print("-" * 60)
            print(data.get('story', 'N/A')[:500])

        except json.JSONDecodeError as e:
            print(f"\n[ERROR] Failed to parse final JSON: {e}")
            print("Raw accumulated text:")
            print(accumulated_text[:1000])  # Show first 1000 chars

    except requests.exceptions.RequestException as e:
        print(f"\n[ERROR] HTTP request error: {e}")
        if hasattr(e.response, 'text'):
            print(f"Response: {e.response.text}")
    except Exception as e:
        print(f"\n[ERROR] Error during streaming: {e}")
        print(f"[ERROR] Error type: {type(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_streaming_structured()
