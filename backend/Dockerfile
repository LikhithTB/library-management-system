FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies first so this layer is cached
# unless requirements.txt actually changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend source
COPY . .

RUN chmod +x entrypoint.sh \
    && useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app

# Don't run the API as root.
USER appuser

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
