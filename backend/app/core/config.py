from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    APP_NAME: str = "NeuroCharge API"
    APP_ENV: str = "development"
    API_V1_STR: str = "/api/v1"
    
    # Delta-Modulation Thresholds (Continuous parameter changes required to trigger a neural spike)
    # Voltage in Volts (V)
    DELTA_THRESHOLD_VOLTAGE: float = 0.05
    # Current in Amperes (A) 
    DELTA_THRESHOLD_CURRENT: float = 0.1
    # Temperature in Celsius (°C)
    DELTA_THRESHOLD_TEMPERATURE: float = 0.2
    # Charge Cycles
    DELTA_THRESHOLD_CHARGE_CYCLES: int = 1

    # Latency limits (warning threshold in ms)
    LATENCY_WARNING_THRESHOLD_MS: float = 500.0

    # Persistence settings
    DATABASE_URL: str = "sqlite:///./neurocharge.db"

    # Security settings
    JWT_SECRET_KEY: str = "5b8f60f64c670a8dcd5b11142e0e0ee8473bb1b59049a4f4efb702ec4c9a8963"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120

    model_config = SettingsConfigDict(env_prefix="NEUROCHARGE_", case_sensitive=True)

settings = Settings()
