#include <Arduino.h>

#define ESP32_CAN_TX_PIN GPIO_NUM_8
#define ESP32_CAN_RX_PIN GPIO_NUM_7

#include <NMEA2000_CAN.h>
#include <N2kMessages.h>
#include <Wire.h>
#include <SparkFun_u-blox_GNSS_Arduino_Library.h>
#include <Adafruit_BNO08x.h>

#include <SPI.h>
#include "FS.h"
#include "SD.h"
#include <Notecard.h>

#define BNO08X_RESET -1

#define LED_PIN 13
#define productUID "com.gmail.ben.ak.sheng:r2ak_data"

Notecard notecard;

static const int sck  = 5;
static const int miso = 21;
static const int mosi = 19;
static const int cs   = 4;

unsigned long lastSampleTime  = 0;
unsigned long lastTransmitTime = 0;

// CHANGED: Removed 'const' so the interval can be modified dynamically by Notehub
unsigned long SAMPLE_INTERVAL = 5000;          // Defaults to 5 seconds averaging window for IMU, GPS, and NMEA2000 data
unsigned long TRANSMIT_INTERVAL = 300000;  // 5 minutes – SD + Blues transmit

File dataFile;

String error = "";

// Data from boat
double DepthBelowTransducer = 0;

double AWS = 0; //Apparent Wind Speed
double AWS_x;
double AWS_y;

double AWA = 0;  //Apparent Wind Angle

// Averaging Earth frame AWS components 
double awsXSum = 0;
double awsYSum = 0;
int awsCount = 0;

double STW = 0;   // Speed Through Water (knots)

double STW_x;
double STW_y;

// Averaging Earth frame STW components 
double stwXSum = 0;
double stwYSum = 0;
int stwCount = 0;

double CurrentSpeed;
double CurrentDir;

double Current_x;
double Current_y;

// True wind output
double TWS; //True Wind Speed
float TWS_x;
float TWS_y;
float TWD; //True Wind Direction

float imu_heading = 0; 
float IMU_FIXED_OFFSET = 107.8; // 242 - 115

// NMEA2000 message handler
void HandleNMEA2000Msg(const tN2kMsg &msg) {

  switch (msg.PGN) {
    // WIND DATA
    case 130306: {
      unsigned char SID;
      double WindSpeed;
      double WindAngle;
      tN2kWindReference ref;

      if (ParseN2kWindSpeed(msg, SID, WindSpeed, WindAngle, ref)) {
        AWS = WindSpeed * 1.94384;    // convert m/s to knots
        AWA = WindAngle * 180.0 / PI; // convert rad to deg
        if (AWA < 0) AWA += 360.0;

        // Project Apparent Wind from boat frame to earth frame
        double headRad = imu_heading * PI / 180.0;
        double awaEarthRad = WindAngle + headRad; // WindAngle from PGN is already in radians

        awsXSum += AWS * sin(awaEarthRad); // Earth East Component
        awsYSum += AWS * cos(awaEarthRad); // Earth North Component
        awsCount++;

        Serial.print("   [WIND] Speed: "); Serial.print(AWS);
        Serial.print(" knots | Angle: "); Serial.println(AWA);
      }
    } break;

    // WATER DEPTH
    case 128267: {
      unsigned char SID;
 
      double Offset;

      if (ParseN2kWaterDepth(msg, SID, DepthBelowTransducer, Offset)) {
        Serial.print("   [DEPTH] "); Serial.print(DepthBelowTransducer); Serial.println(" m");
      }
    } break;

    // KNOTMETER DATA
    case 128259: {
      unsigned char SID;
      double WaterReferencedSpeed;
      double GroundReferencedSpeed;
      tN2kSpeedWaterReferenceType SWRT;

      if (ParseN2kBoatSpeed(msg, SID, WaterReferencedSpeed, GroundReferencedSpeed, SWRT)) {
        STW = WaterReferencedSpeed * 1.94384; // m/s -> knots
        
        // MODIFIED: Project STW into Earth Frame immediately using latest heading
        double headRad = imu_heading * PI / 180.0;
        stwXSum += STW * sin(headRad); // Earth East Component
        stwYSum += STW * cos(headRad); // Earth North Component
        stwCount++;

        Serial.print("   [KNOTMETER] Speed: "); Serial.print(STW); Serial.println(" knots");
      }
    } break;
  }
}

// GNSS Declarations
SFE_UBLOX_GNSS myGNSS;

double lat = 0, lon = 0;
long altitude = 0;
double SOG = 0;
double SOG_x;
double SOG_y;
double COG = 0;
int hour = 0, minute = 0, second = 0;

// averaging SOG vector components (Earth frame) 
double sogXSum = 0;
double sogYSum = 0;
int sogCount = 0;

// IMU (I2C)
Adafruit_BNO08x bno085(BNO08X_RESET);
sh2_SensorValue_t sensorValue;

// averaging IMU 
double imuSinSum = 0;
double imuCosSum = 0;
int imuCount = 0;

// IMU DATA READING
void updateIMU() {
  if (bno085.wasReset()) {
    Serial.println("Sensor reset, re-enabling reports...");
    bno085.enableReport(SH2_ROTATION_VECTOR);
  }

  if (!bno085.getSensorEvent(&sensorValue)) return;

  if (sensorValue.sensorId == SH2_ROTATION_VECTOR) {

    float qw = sensorValue.un.rotationVector.real;
    float qx = sensorValue.un.rotationVector.i;
    float qy = sensorValue.un.rotationVector.j;
    float qz = sensorValue.un.rotationVector.k;

    float yaw = atan2(2.0f * (qw * qz + qx * qy),
                      1.0f - 2.0f * (qy * qy + qz * qz));

    float heading = yaw * 180.0f / PI; //convert rad to deg
    if (heading < 0) heading += 360.0f;

    // Apply fixed alignment offset
    float correctedHeading = heading - IMU_FIXED_OFFSET;

    if (correctedHeading < 0) correctedHeading += 360.0f;
    if (correctedHeading >= 360.0f) correctedHeading -= 360.0f;

    imu_heading = correctedHeading;

    double headingRad = heading * PI / 180.0;

    imuSinSum += sin(headingRad);
    imuCosSum += cos(headingRad);
    imuCount++;
  }
}

// GNSS DATA READING
void readGNSS() {
  if (myGNSS.getPVT() && myGNSS.getInvalidLlh() == false) {
    lat = myGNSS.getLatitude() / 10000000.0;
    lon = myGNSS.getLongitude() / 10000000.0;

    altitude = myGNSS.getAltitude();

    double speed_m_s = myGNSS.getGroundSpeed() / 1000.0;
    SOG = speed_m_s * 1.94384; // m/s -> knots

    COG = myGNSS.getHeading() / 100000.0;

    double cogRad = COG * PI / 180.0;

    sogXSum += SOG * sin(cogRad); // East component
    sogYSum += SOG * cos(cogRad); // North component
    sogCount++;

    hour = myGNSS.getHour();
    minute = myGNSS.getMinute();
    second = myGNSS.getSecond();
  }
}

void writeToBlues() {
  J *req = notecard.newRequest("note.add");
  if (req == NULL) {
    Serial.println("Notecard Fail");
    error += "Failed to create note.add; ";
    return;
  }

  JAddBoolToObject(req, "sync", true);

  J *body = JCreateObject();
  if (body) {
    JAddNumberToObject(body, "Hour",   hour);
    JAddNumberToObject(body, "Minute", minute);
    JAddNumberToObject(body, "Second", second);

    JAddNumberToObject(body, "Latitude",      lat);
    JAddNumberToObject(body, "Longitude",     lon);
    JAddNumberToObject(body, "Altitude",      altitude);
    JAddNumberToObject(body, "Speed (Knots)", SOG);
    JAddNumberToObject(body, "Heading (deg)", COG);
    JAddNumberToObject(body, "IMU Heading (avg)", imu_heading);

    JAddNumberToObject(body, "Apparent Wind Speed",            AWS);
    JAddNumberToObject(body, "Apparent Wind Angle",            AWA);
    JAddNumberToObject(body, "Apparent Wind Speed X-Component", AWS_x);
    JAddNumberToObject(body, "Apparent Wind Speed Y-Component", AWS_y);

    JAddNumberToObject(body, "True Wind Speed",     TWS);
    JAddNumberToObject(body, "True Wind Direction", TWD);

    JAddNumberToObject(body, "Speed Through Water",             STW);
    JAddNumberToObject(body, "Speed Through Water X-Component", STW_x);
    JAddNumberToObject(body, "Speed Through Water Y-Component", STW_y);

    JAddNumberToObject(body, "Current Speed",       CurrentSpeed);
    JAddNumberToObject(body, "Current Direction",   CurrentDir);
    JAddNumberToObject(body, "Current X-Component", Current_x);
    JAddNumberToObject(body, "Current Y-Component", Current_y);

    JAddStringToObject(body, "Error", error.c_str());

    JAddItemToObject(req, "body", body);
  }

  NoteRequest(req);
}

void writeToSD() {
  dataFile = SD.open("/datalog.txt", FILE_APPEND);

  if (!dataFile) {
    Serial.println("Error opening file for logging.");
    error += "SD open failed in writeToSD; ";
    return;
  }

  // Timestamp
  dataFile.print("UTC: ");
  if (hour < 10) { dataFile.print("0"); dataFile.print(hour); dataFile.print(":"); }
  if (minute < 10) { dataFile.print("0"); dataFile.print(minute); dataFile.print(":"); } 
  if (second < 10) { dataFile.print("0"); dataFile.println(second); }
  
  // Position & GNSS
  dataFile.print("Latitude: "); dataFile.println(lat, 6);
  dataFile.print("Longitude: "); dataFile.println(lon, 6);
  dataFile.print("Altitude: "); dataFile.println(altitude);
  dataFile.print("SOG (knots): "); dataFile.println(SOG);
  dataFile.print("COG (deg): "); dataFile.println(COG);

  // IMU
  dataFile.print("IMU Heading (avg): "); dataFile.println(imu_heading);

  // Apparent wind
  dataFile.print("Apparent Wind Speed (knots): "); dataFile.println(AWS);
  dataFile.print("Apparent Wind Angle (deg): "); dataFile.println(AWA);
  dataFile.print("AWS X-Component: "); dataFile.println(AWS_x);
  dataFile.print("AWS Y-Component: "); dataFile.println(AWS_y);

  // True wind
  dataFile.print("True Wind Speed (knots): "); dataFile.println(TWS);
  dataFile.print("True Wind Direction (deg): "); dataFile.println(TWD);

  // Speed through water
  dataFile.print("Speed Through Water (knots): "); dataFile.println(STW);
  dataFile.print("STW X-Component: "); dataFile.println(STW_x);
  dataFile.print("STW Y-Component: "); dataFile.println(STW_y);

  // Current
  dataFile.print("Current Speed (knots): "); dataFile.println(CurrentSpeed);
  dataFile.print("Current Direction (deg): "); dataFile.println(CurrentDir);
  dataFile.print("Current X-Component: "); dataFile.println(Current_x);
  dataFile.print("Current Y-Component: "); dataFile.println(Current_y);

  // Errors
  dataFile.print("Errors: "); dataFile.println(error.length() > 0 ? error : "None");

  dataFile.println("---");
  dataFile.close();
  Serial.println("Data written to SD.");
}

// ADDED: Environment Sync Function to read cache from local storage
void checkCloudInterval() {
  J *req = notecard.newRequest("env.get");
  if (req == NULL) return;

  // Fetch all three in one call — no "name" filter
  J *rsp = notecard.requestAndResponse(req);
  if (rsp == NULL) return;

  J *body = JGetObject(rsp, "body");
  if (body != NULL) {

    // avg_interval
    const char *intervalStr = JGetString(body, "avg_interval");
    if (intervalStr && strlen(intervalStr) > 0) {
      int cloudValueSeconds = atoi(intervalStr);
      if (cloudValueSeconds >= 1) {
        SAMPLE_INTERVAL = cloudValueSeconds * 1000;
        Serial.print("Sample interval updated to: ");
        Serial.println(SAMPLE_INTERVAL);
      }
    }

    // imu_heading_offset
    const char *offsetStr = JGetString(body, "imu_heading_offset");
    if (offsetStr && strlen(offsetStr) > 0) {
      float cloudOffset = atof(offsetStr);
      if (cloudOffset >= 0.0 && cloudOffset < 360.0) {
        IMU_FIXED_OFFSET = cloudOffset;
        Serial.print("IMU offset updated to: ");
        Serial.println(IMU_FIXED_OFFSET);
      }
    }

    // transmit_interval
    const char *transmitStr = JGetString(body, "transmit_interval");
    if (transmitStr && strlen(transmitStr) > 0) {
      int cloudValueSeconds = atoi(transmitStr);
      if (cloudValueSeconds >= 10) {
        TRANSMIT_INTERVAL = (unsigned long)cloudValueSeconds * 1000;
        Serial.print("Transmit interval updated to: ");
        Serial.println(TRANSMIT_INTERVAL);
      }
    }
  }

  notecard.deleteResponse(rsp);
}

// =====================================================
// Setup
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(3000);
  Serial.println("Boot");

  // SD Card
  SPI.begin(sck, miso, mosi, cs);
  Serial.println("SPI Started");
  delay(1000);

  Wire.begin();

  if (!SD.begin(cs, SPI, 400000)) {
    Serial.println("SD card mount failed");
    error += "SD mount failed in setup; ";
  } else {
    Serial.println("SD Card Success");
  }

  // Notecard
  notecard.setDebugOutputStream(Serial);
  Serial.println("Starting notecard");
  notecard.begin();
  Serial.println("Notecard OK");

  J *req = notecard.newRequest("hub.set");
  if (req != NULL) {
    JAddStringToObject(req, "product", productUID);
    JAddStringToObject(req, "mode", "continuous");
    JAddNumberToObject(req, "outbound", 1); 
    NoteRequest(req);
  } else {
    error += "hub.set request failed; ";
  }

  req = notecard.newRequest("card.location.mode");
  if (req != NULL) {
    JAddStringToObject(req, "mode", "off");
    notecard.sendRequest(req);
  } else {
    error += "card.location.mode request failed; ";
  }

  J *syncReq = notecard.newRequest("hub.sync");
  if (syncReq != NULL) {
    notecard.sendRequest(syncReq);
  } else {
    error += "hub.sync request failed; ";
  }

  // GNSS
  if (!myGNSS.begin(Wire)) {
    Serial.println("GNSS failed");
    error += "GNSS init failed; ";
  }

  // IMU
  delay(500); // give BNO085 time to boot
  if (!bno085.begin_I2C(0x4A, &Wire)) {
    Serial.println("IMU failed");
    error += "IMU init failed; ";
  } else {
    Serial.println("IMU OK");
    bno085.enableReport(SH2_ROTATION_VECTOR);
    delay(100); // give report time to enable
  }

  NMEA2000.SetProductInformation("1", 1, "ESP32 Feather", "1.0", "1.0");
  NMEA2000.SetDeviceInformation(25, 130, 75, 2046);
  NMEA2000.SetMode(tNMEA2000::N2km_ListenOnly);
  NMEA2000.SetMsgHandler(HandleNMEA2000Msg);
  NMEA2000.Open();

  pinMode(LED_PIN, OUTPUT);

  Serial.println("System ready");
}

void loop() {
  NMEA2000.ParseMessages();
  updateIMU();
  readGNSS();

  if (!SD.begin(cs, SPI, 400000)) {
    error += "SD remount failed; ";
    digitalWrite(LED_PIN, HIGH);
    delay(1000);
    digitalWrite(LED_PIN, LOW);
    delay(1000);
  }

  if (millis() - lastSampleTime >= SAMPLE_INTERVAL) {
    lastSampleTime = millis();

    // Circular average heading
    if (imuCount > 0) {
      imu_heading = atan2(imuSinSum / imuCount, imuCosSum / imuCount) * 180.0 / PI;
      if (imu_heading < 0) imu_heading += 360.0;
    }

    // Average GPS velocity vector
    if (sogCount > 0) {
      SOG_x = sogXSum / sogCount;
      SOG_y = sogYSum / sogCount;
      SOG = sqrt(SOG_x * SOG_x + SOG_y * SOG_y);
      COG = atan2(SOG_x, SOG_y) * 180.0 / PI;
      if (COG < 0) COG += 360.0;
    }

    // Average Earth Frame Apparent Wind vector
    if (awsCount > 0) {
      AWS_x = awsXSum / awsCount;
      AWS_y = awsYSum / awsCount;
      AWS = sqrt(AWS_x * AWS_x + AWS_y * AWS_y);
      AWA = atan2(AWS_x, AWS_y) * 180.0 / PI;
      if (AWA < 0) AWA += 360.0;
    }

    // Average Earth Frame STW vector
    if (stwCount > 0) {
      STW_x = stwXSum / stwCount;
      STW_y = stwYSum / stwCount;
      STW = sqrt(STW_x * STW_x + STW_y * STW_y);
    }

    // True Wind calculation
    TWS_x = AWS_x - SOG_x;
    TWS_y = AWS_y - SOG_y;
    TWS = sqrt(TWS_x * TWS_x + TWS_y * TWS_y);
    TWD = atan2(TWS_x, TWS_y) * 180.0 / PI;
    if (TWD < 0) TWD += 360.0;

    // True Current Vector calculation
    Current_x = SOG_x - STW_x;
    Current_y = SOG_y - STW_y;
    CurrentSpeed = sqrt(Current_x * Current_x + Current_y * Current_y);
    CurrentDir = atan2(Current_x, Current_y) * 180.0 / PI;
    if (CurrentDir < 0) CurrentDir += 360.0;

    // Reset values for next averaging interval
    imuSinSum = 0; imuCosSum = 0; imuCount = 0;
    sogXSum = 0; sogYSum = 0; sogCount = 0;
    awsXSum = 0; awsYSum = 0; awsCount = 0;
    stwXSum = 0; stwYSum = 0; stwCount = 0;

    // prints
    Serial.print("Lat: "); Serial.println(lat, 6);
    Serial.print("Lon: "); Serial.println(lon, 6);
    Serial.print("SOG (knots): "); Serial.println(SOG);
    Serial.print("COG (deg): "); Serial.println(COG);
    Serial.print("IMU Heading (avg): "); Serial.println(imu_heading);
    Serial.print("True wind speed (knots): "); Serial.println(TWS);
    Serial.print("True wind direction (deg): "); Serial.println(TWD);
    Serial.print("True current speed (knots): "); Serial.println(CurrentSpeed);
    Serial.print("True current direction (deg): "); Serial.println(CurrentDir);

    // CHANGED: Added function call to fetch remote values from local cache
    checkCloudInterval(); 
  } 

  if (error.length() > 0) {
    Serial.print("Errors: ");
    Serial.println(error);
  }

  if (millis() - lastTransmitTime >= TRANSMIT_INTERVAL) {
    lastTransmitTime = millis();
    error = ""; 
    Serial.println("Transmitting data...");
    writeToBlues();
    writeToSD();
  }
}
