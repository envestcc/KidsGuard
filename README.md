# 🛡️ KidsGuard — AI-Powered Child Safety Monitoring

> **Hackathon Project** — Uses [Trio API](https://docs.machinefi.com) to monitor live streams and detect dangerous situations for children in real time.

![Python](https://img.shields.io/badge/Python-3.10+-blue) ![Trio API](https://img.shields.io/badge/Trio_API-Integrated-green) ![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 🎯 Problem

Parents can't always watch their children. Traditional home cameras only provide video feeds—no intelligent analysis or real-time alerts.

## 💡 Solution

KidsGuard uses **Trio API's AI vision capabilities** to monitor home camera live streams and **automatically detect dangerous situations**:

| Danger Level | Examples |
|---|---|
| 🔴 **High** | Child climbing windows/balconies, accessing knives/medicine |
| 🟡 **Medium** | Child alone in kitchen/bathroom, strangers entering |
| 🟢 **Safe** | Child playing safely in living areas |

## 🏗️ Architecture

```
Home Camera (RTSP) → FFmpeg → YouTube/Twitch Live
                                      ↓
                                Trio API (AI Vision)
                                      ↓
                              KidsGuard Backend (Flask)
                                      ↓
                            Web Dashboard + Alerts
```

## 🚀 Quick Start

```bash
# 1. Navigate to the project
cd kidsguard

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set your API key (optional — default is embedded for demo)
export TRIO_API_KEY="your-api-key"

# 4. Run
python app.py
```

Open **http://localhost:5000** in your browser.

## 📡 Trio API Integration

This project uses **all major Trio API endpoints**:

| Endpoint | Usage |
|---|---|
| `POST /api/check-once` | One-shot safety checks with 6 preset danger conditions |
| `POST /api/live-monitor` | Continuous monitoring with webhook alerts |
| `POST /api/live-digest` | SSE-streamed activity summaries |
| `GET /api/jobs` | List all active monitoring jobs |
| `GET /api/jobs/{id}` | Get job status and statistics |
| `DELETE /api/jobs/{id}` | Cancel a running job |

## 🖥️ Features

### 1. Stream Configuration
- Enter YouTube/Twitch live stream URL
- One-click stream validation via Trio API
- Embedded stream preview player

### 2. Safety Check Dashboard
- **6 preset danger detection buttons** (one-click):
  - 🛡️ Is Child Safe? — General safety check
  - 🧗 Climbing Danger — Fall risk detection
  - 🔪 Dangerous Objects — Hazard detection
  - 👤 Stranger Alert — Intruder detection
  - 🚪 Alone in Danger Zone — Location risk
  - 🌊 Water Hazard — Drowning risk
- Custom condition input for flexible AI queries
- Visual danger level indicators (🔴🟡🟢)

### 3. Live Monitoring
- Start/stop continuous monitoring with webhook alerts
- Real-time job status display
- Active job management with cancel support

### 4. Activity Digest
- AI-generated narrative summaries of stream activity
- Real-time SSE streaming display

### 5. Alert History
- Timestamped log of all safety checks
- Filter by danger level
- Export to JSON for reporting

## 🎨 UI Highlights

- Dark glassmorphic design
- Animated danger alerts with pulsing effects
- Toast notifications for real-time feedback
- Light/dark theme toggle
- Responsive layout (desktop & tablet)

## 📁 Project Structure

```
kidsguard/
├── app.py                 # Flask backend — routes, webhook handler, API proxy
├── trio_client.py         # Trio API wrapper — all endpoint integrations
├── requirements.txt       # Python dependencies
├── templates/
│   └── index.html         # Dashboard HTML
└── static/
    ├── css/style.css      # Dark glassmorphic styles
    └── js/app.js          # Frontend logic & Trio API interactions
```

## 🏆 Judging Criteria Alignment

- **Creativity (40%)**: AI-powered child safety monitoring — a unique use case for live stream AI analysis
- **Trio API Usage (30%)**: Integrates ALL major endpoints (check-once, live-monitor, live-digest, jobs, cancel)
- **Impact (15%)**: Real-world application for millions of parents
- **Polish (15%)**: Professional dark dashboard UI, smooth UX, ready for live demo

## 📝 Demo Script (5 minutes)

1. **Setup** (30s): Open dashboard, enter Twitch/YouTube stream URL, click Test
2. **Safety Checks** (90s): Click through preset buttons, show AI responses
3. **Custom Query** (30s): Type custom safety question, show flexibility
4. **Live Monitoring** (60s): Start continuous monitoring, show webhook alerts
5. **Activity Digest** (30s): Generate AI summary of stream activity
6. **Alert History** (30s): Filter and export safety check history
7. **Wrap-up** (30s): Key innovation — context-aware AI vs. motion detection

---

*Built for the Internal Hackathon 2026 🚀*
