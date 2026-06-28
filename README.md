# Chess Prize Odds

A web application that calculates a player's **expected prize value (EV)** and **finishing probabilities** in a Swiss‑system chess tournament. Upload a pairing sheet, verify extracted pairings, enter prize information, and instantly receive simulated odds for each prize tier.

---

## ✨ Features

- **[AI pairing extraction](ca://s?q=Explain_AI_pairing_extraction)** from SwissSys pairing sheet images  
- **[Automatic player and score detection](ca://s?q=How_does_player_detection_work)**  
- **[Prize EV simulation](ca://s?q=What_is_prize_EV_in_chess)** using Monte Carlo modeling  
- **[Swiss‑system round modeling](ca://s?q=Explain_Swiss_system_modeling)** with realistic pairing constraints  
- **[Interactive verification UI](ca://s?q=Describe_pairing_verification_UI)** for correcting OCR errors  
- **[Instant probability output](ca://s?q=How_to_interpret_probability_output)** for each prize position  

---

## 🚀 How It Works

### 1. Upload Pairing Sheet
Upload a photo or screenshot of your SwissSys pairing sheet.  
The system extracts:
- Player names  
- Current scores  
- Round pairings  

### 2. Verify Extracted Pairings
Confirm or correct the extracted data in a clean table:
- White  
- Black  
- Scores  
- Round status  

### 3. Enter Prize Information
Input:
- Prize amounts  
- Your name (exactly as it appears in the pairings)  

### 4. Run the Simulation
The engine simulates thousands of tournament outcomes and returns:
- Probability of each finishing place  
- Expected prize value  
- Upset likelihoods  
- Performance distribution  

---

## 📊 Example Output

- 1st place: 12.4%  
- 2nd place: 18.7%  
- 3rd place: 22.1%  
- **Expected prize value:** \$413.27  

---

## 🛠️ Tech Stack

- **Frontend:** React + Tailwind  
- **Backend:** Python / FastAPI  
- **OCR:** Tesseract + custom post‑processing  
- **Simulation:** Monte Carlo Swiss‑system model  
- **Hosting:** Vercel / Railway  

---

## 📦 Installation

```bash
git clone https://github.com/yourusername/chess-prize-odds
cd chess-prize-odds
npm install
npm run dev
