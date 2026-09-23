### For first setup
To setup a project, you should be in ```/backend``` directory
#### Unix/macOs
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
#### Windows
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run backend
To run backend, you should be in ```/backend``` directory
```bash
uvicorn app.main:app --reload
```