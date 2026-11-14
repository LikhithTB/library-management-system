FROM jenkins/jenkins:lts

# The stock image has neither Python nor Node.js, and the pipeline needs both.
USER root
RUN apt-get update \
 && apt-get install -y python3 python3-pip python3-venv curl \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

USER jenkins
