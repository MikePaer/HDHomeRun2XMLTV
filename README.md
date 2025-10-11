# HDHomeRun EPG to XMLTV Converter

A Node.js/TypeScript server that fetches Electronic Program Guide (EPG) data directly from your HDHomeRun device and serves it as standard XMLTV format for Plex, Jellyfin, Emby, and other media servers.

## Features

- **Direct HDHomeRun Integration** - No Schedules Direct subscription required
- **Standard XMLTV Output** - Compatible with Plex, Jellyfin, Emby, xTeVe, Threadfin
- **Memory-Efficient Streaming** - Handles any EPG size with constant memory usage
- **Versioned EPG Files** - Automatic backups with rollback capability
- **Dummy Programming** - Fills channels without EPG data with placeholder programs
- **Flexible Query Parameters** - Customize output on-demand
- **Automatic Updates** - Configurable cron scheduling
- **Health Monitoring** - Built-in health checks and status endpoints

## Quick Start (Docker)

### Docker Compose (Recommended)

1. Create `docker-compose.yml`:

```yaml
services:
  hdhr-epg:
    image: hdhr-epg2xml:latest
    container_name: hdhr-epg-server
    restart: unless-stopped

    ports:
      - "8083:8083"

    environment:
      HDHOMERUN_HOST: 192.168.1.100  # Change to your HDHomeRun IP
      TZ: America/Chicago
      CRON_SCHEDULE: "0 3 * * *"
      DAYS: 7
      ENABLE_DUMMY_PROGRAMMING: true

    volumes:
      - ./epg-output:/app/output
```

2. Start the container:

```bash
docker-compose up -d
```

3. Access EPG at: `http://localhost:8083/epg.xml`

### Docker Run

```bash
docker run -d \
  --name hdhr-epg-server \
  -p 8083:8083 \
  -e HDHOMERUN_HOST=192.168.1.100 \
  -e TZ=America/Chicago \
  -v ./epg-output:/app/output \
  hdhr-epg2xml:latest
```

## Unraid Installation

1. Open **Community Applications**
2. Search for "HDHomeRun EPG"
3. Click **Install**
4. Configure your HDHomeRun IP address
5. Set your timezone
6. Click **Apply**

The EPG will be available at: `http://[UNRAID-IP]:8083/epg.xml`

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HDHOMERUN_HOST` | *Required* | IP address of your HDHomeRun device |
| `TZ` | `America/Chicago` | Timezone for scheduling |
| `WEB_PORT` | `8083` | HTTP server port |
| `CRON_SCHEDULE` | `0 3 * * *` | Update schedule (cron format) |
| `DAYS` | `7` | Days of EPG data to fetch (1-14) |
| `HOURS_INCREMENT` | `3` | Hour increment for EPG fetching (1-6) |
| `RUN_ON_START` | `true` | Fetch EPG immediately on start |
| `ENABLE_DUMMY_PROGRAMMING` | `true` | Add placeholder programs for empty channels |
| `DUMMY_PROGRAM_TITLE` | `No Information` | Title for dummy programmes |
| `DUMMY_PROGRAM_DESC` | `No program information...` | Description template |

## API Endpoints

### EPG Data

- **`/epg.xml`** - Standard XMLTV format
- **`/xmltv.xml`** - Alias for `/epg.xml`
- **`/guide.xml`** - Alias for `/epg.xml`

### Query Parameters

**Dummy Programming:**
- `?dummy=30min` - 30-minute blocks
- `?dummy=1hr` - 1-hour blocks
- `?dummy=2hr` - 2-hour blocks
- `?dummy=3hr` - 3-hour blocks
- `?dummy=6hr` - 6-hour blocks

**Days Filter:**
- `?days=1` - Limit to 1 day
- `?days=3` - Limit to 3 days
- `?days=7` - Full week

**Combined:**
- `?dummy=1hr&days=3` - 1-hour blocks, 3 days only

### Status & Health

- **`/status`** - JSON status information
- **`/health`** - Health check (returns "OK")
- **`/`** - HTML dashboard with examples

## Usage Examples

### Plex

1. Settings → Live TV & DVR → DVR Settings
2. Electronic Program Guide → XMLTV
3. Enter: `http://[SERVER-IP]:8083/epg.xml`

### Jellyfin

1. Dashboard → Live TV
2. EPG Guide Data Provider → XMLTV
3. File or URL: `http://[SERVER-IP]:8083/epg.xml`

### Emby

1. Settings → Live TV
2. Guide → XMLTV
3. URL: `http://[SERVER-IP]:8083/epg.xml`

### Custom Configurations

**30-minute blocks for smaller EPG:**
```
http://[SERVER-IP]:8083/epg.xml?dummy=30min&days=3
```

**2-hour blocks for minimal bandwidth:**
```
http://[SERVER-IP]:8083/epg.xml?dummy=2hr&days=1
```

## Building from Source

### Prerequisites

- Node.js 20 or higher
- npm or yarn
- Docker (for containerization)

### Local Development

```bash
# Clone repository
git clone https://github.com/metaColin/HDHR-EPG2XML-for-Unraid.git
cd HDHR-EPG2XML-for-Unraid

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your HDHomeRun IP
nano .env

# Build
npm run build

# Start
npm start
```

### Building Docker Image

```bash
# Build image
docker build -t hdhr-epg2xml:latest .

# Test locally
docker run -d \
  --name hdhr-epg-test \
  -p 8083:8083 \
  -e HDHOMERUN_HOST=192.168.1.100 \
  -v ./output:/app/output \
  hdhr-epg2xml:latest

# View logs
docker logs -f hdhr-epg-test
```

## Architecture

- **Node.js 20 LTS** - Runtime
- **TypeScript 5** - Type safety
- **Express** - HTTP server
- **node-cron** - Scheduling
- **axios** - HTTP client with retry logic
- **fast-xml-parser** - XML parsing
- **Transform Streams** - Memory-efficient processing

## Performance

- **EPG Generation:** ~7 seconds for 7 days
- **Memory Usage:** ~50MB constant (streaming)
- **Image Size:** 214MB (Alpine-based)
- **Streaming Operations:** <200ms for filters

## Troubleshooting

### Container won't start

Check logs:
```bash
docker logs hdhr-epg-server
```

Verify HDHomeRun IP is accessible:
```bash
curl http://[HDHOMERUN-IP]/discover.json
```

### EPG not updating

Check cron schedule:
```bash
docker exec hdhr-epg-server printenv CRON_SCHEDULE
```

Trigger manual update:
```bash
docker restart hdhr-epg-server
```

### Empty channels

Enable dummy programming:
```bash
-e ENABLE_DUMMY_PROGRAMMING=true
```

Or use query parameter:
```
http://[SERVER-IP]:8083/epg.xml?dummy=1hr
```

## Contributing

This project is in active development. Contributions, issues, and feature requests are welcome.

## License

GPL-3.0 License

## Credits

Built to help HDHomeRun users avoid unnecessary Schedules Direct subscriptions while providing a reliable, efficient EPG solution for self-hosted media servers.

## Support

- **Issues:** https://github.com/metaColin/HDHR-EPG2XML-for-Unraid/issues
- **Documentation:** https://github.com/metaColin/HDHR-EPG2XML-for-Unraid
