# Audio2TextBot

Audio2TextBot is a Telegram bot that facilitates audio and video file processing to convert them into text format using various pre-trained models.

![VIEWS](https://komarev.com/ghpvc/?username=rn0x-audio2textbot&label=REPOSITORY+VIEWS&style=for-the-badge)

## Installation

To run the bot locally or on your server, follow these steps:

1. **Clone the repository:**

   ```bash
   git clone https://github.com/rn0x/Audio2TextBot.git
   cd Audio2TextBot
   ```

2. **Install dependencies:**

   Make sure you have Node.js (version 14 or higher) installed.

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   Create a `.env` file in the root directory with the following variables:

   ```plaintext
   TELEGRAM_TOKEN=your_telegram_bot_token
   WHISPER_MODEL=your_whisper_model_path
   # WHISPER_LANGUAGE="auto"
   WHISPER_LANGUAGE=your_whisper_language
   ```

**WHISPER_MODEL**
   ```plaintext
| Model     | Disk   | RAM     |
|-----------|--------|---------|
| tiny      |  75 MB | ~390 MB |
| tiny.en   |  75 MB | ~390 MB |
| base      | 142 MB | ~500 MB |
| base.en   | 142 MB | ~500 MB |
| small     | 466 MB | ~1.0 GB |
| small.en  | 466 MB | ~1.0 GB |
| medium    | 1.5 GB | ~2.6 GB |
| medium.en | 1.5 GB | ~2.6 GB |
| large-v1  | 2.9 GB | ~4.7 GB |
| large     | 2.9 GB | ~4.7 GB |
```

4. **Initialize the SQLite database:**

   The bot uses `better-sqlite3` for database operations. Ensure the database file `database.db` is created automatically when the bot starts.

5. **Start the bot:**

   Run the bot using `nodemon` for development or `node` for production:

   ```bash
   npm start
   ```

## Usage

- Start the bot and send an audio or video file to convert it into text.
- Use the `/users` command to fetch all users who have interacted with the bot.

## Bot Features

- Converts audio and video files to text.
- Logs user interactions in a SQLite database.
- Supports multiple media formats and languages for transcription.

## Author

- [Ryan Almalki](https://github.com/rn0x)

## License

This project is licensed under the MIT License.
