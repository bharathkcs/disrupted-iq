FROM python:3.11-slim

WORKDIR /app

# System deps for xgboost / scikit-learn
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000

CMD ["python", "main.py"]
