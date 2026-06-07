#include <SPI.h>
#include "FS.h"
#include "SD.h"
#include <Notecard.h>
#include <Wire.h>
#include <SparkFun_u-blox_GNSS_Arduino_Library.h>
#include <Adafruit_BNO08x.h>
#include <NMEA2000_CAN.h>
#include <N2kMessages.h>

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
const unsigned long SAMPLE_INTERVAL   = 5000;   // 5 seconds  – IMU averaging & compute
const unsigned long TRANSMIT_INTERVAL = 300000;  // 5 minutes – SD + Blues transmit

File dataFile;

String error = "";

// Data from boat
double AWS = 0;
double AWS_x;
double AWS_y;

double AWA = 0;

double AWS_raw = 0;
double AWA_raw = 0;

double STW = 0;

double STW_x;
double STW_y;

double CurrentSpeed;
double CurrentDir;

double Current_x;
double Current_y;

// True wind output
double TWS;
float TWS_x;
float TWS_y;
float TWD;

// NMEA2000 message handler
void HandleNMEA2000Msg(const tN2kMsg &msg) {

  switch (msg.PGN) {

    case 130306: {
      unsigned char SID;
      double WindSpeed;
      double WindAngle;
      tN2kWindReference ref;

      if (ParseN2kWindSpeed(msg, SID, WindSpeed, WindAngle, ref)) {
        AWS_raw = WindSpeed;
        AWA_raw = WindAngle;

        AWS = WindSpeed * 1.94384;
        AWA = WindAngle * 180.0 / PI;

        if (AWA < 0) AWA += 360.0;
      }
    } break;

    case 128267: {
      unsigned char SID;
      double DepthBelowTransducer;
      double Offset;

      if (ParseN2kWaterDepth(msg, SID, DepthBelowTransducer, Offset)) {
        Serial.print("Depth: ");
        Serial.println(DepthBelowTransducer);
      }
    } break;

    case 128259: {
      unsigned char SID;
      double WaterReferencedSpeed;
      double GroundReferencedSpeed;
      tN2kSpeedWaterReferenceType SWRT;

      if (ParseN2kBoatSpeed(msg, SID, WaterReferencedSpeed, GroundReferencedSpeed, SWRT)) {
        STW = WaterReferencedSpeed * 1.94384;
      }
    } break;
  }
}

// GNSS
SFE_UBLOX_GNSS myGNSS;

double lat = 0, lon = 0;
long altitude = 0;
double SOG = 0;
double SOG_x;
double SOG_y;
double COG = 0;
int hour = 0, minute = 0, second = 0;

// IMU
Adafruit_BNO08x bno085(BNO08X_RESET);
sh2_SensorValue_t sensorValue;

float imu_heading = 0;

float imuSum = 0;
int imuCount = 0;

void updateIMU() {
  if (bno085.wasReset()) {
    Serial.println("Sensor reset, re-enabling reports...");
    if (!bno085.enableReport(SH2_ROTATION_VECTOR)) {
      error += "IMU re-enable failed after reset; ";
    }
  }

  if (!bno085.getSensorEvent(&sensorValue)) return;

  if (sensorValue.sensorId == SH2_ROTATION_VECTOR) {
    float qw = sensorValue.un.rotationVector.real;
    float qx = sensorValue.un.rotationVector.i;
    float qy = sensorValue.un.rotationVector.j;
    float qz = sensorValue.un.rotationVector.k;

    float yaw = atan2(2.0f * (qw * qz + qx * qy),
                      1.0f - 2.0f * (qy * qy + qz * qz));

    float heading = yaw * 180.0f / PI;
    if (heading < 0) heading += 360.0f;

    imuSum += heading;
    imuCount++;
  }
}

void readGNSS() {
  lat      = myGNSS.getLatitude()    / 10000000.0;
  lon      = myGNSS.getLongitude()   / 10000000.0;
  altitude = myGNSS.getAltitude();

  double speed_m_s = myGNSS.getGroundSpeed() / 1000.0;
  SOG    = speed_m_s * 1.94384;
  COG    = myGNSS.getHeading() / 100000.0;
  hour   = myGNSS.getHour();
  minute = myGNSS.getMinute();
  second = myGNSS.getSecond();
}

void writeToBlues() {
  J *req = notecard.newRequest("note.add");
  if (req == NULL) {
    Serial.println("Notecard Fail");
    error += "Failed to create note.add; ";
    return;
  }

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
  if (hour < 10) {
    dataFile.print("0");
    dataFile.print(hour);   
    dataFile.print(":");
  }
  if (minute < 10) {
    dataFile.print("0");
    dataFile.print(minute); 
    dataFile.print(":");
  } 
  if (second < 10) {
    dataFile.print("0");
    dataFile.println(second);
  }
  

  // Position & GNSS
  dataFile.print("Latitude: ");          
  dataFile.println(lat, 6);
  dataFile.print("Longitude: ");         
  dataFile.println(lon, 6);
  dataFile.print("Altitude: ");          
  dataFile.println(altitude);
  dataFile.print("SOG (knots): ");       
  dataFile.println(SOG);
  dataFile.print("COG (deg): ");         
  dataFile.println(COG);

  // IMU
  dataFile.print("IMU Heading (avg): "); 
  dataFile.println(imu_heading);

  // Apparent wind
  dataFile.print("Apparent Wind Speed (knots): "); 
  dataFile.println(AWS);
  dataFile.print("Apparent Wind Angle (deg): ");   
  dataFile.println(AWA);
  dataFile.print("AWS X-Component: ");             
  dataFile.println(AWS_x);
  dataFile.print("AWS Y-Component: ");             
  dataFile.println(AWS_y);

  // True wind
  dataFile.print("True Wind Speed (knots): ");     
  dataFile.println(TWS);
  dataFile.print("True Wind Direction (deg): ");   
  dataFile.println(TWD);

  // Speed through water
  dataFile.print("Speed Through Water (knots): "); 
  dataFile.println(STW);
  dataFile.print("STW X-Component: ");             
  dataFile.println(STW_x);
  dataFile.print("STW Y-Component: ");             
  dataFile.println(STW_y);

  // Current
  dataFile.print("Current Speed (knots): ");       
  dataFile.println(CurrentSpeed);
  dataFile.print("Current Direction (deg): ");     
  dataFile.println(CurrentDir);
  dataFile.print("Current X-Component: ");         
  dataFile.println(Current_x);
  dataFile.print("Current Y-Component: ");         
  dataFile.println(Current_y);

  // Errors
  dataFile.print("Errors: ");
  dataFile.println(error.length() > 0 ? error : "None");

  dataFile.println("---");
  dataFile.close();

  Serial.println("Data written to SD.");
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
  if (!bno085.begin_I2C()) {
    Serial.println("IMU failed");
    error += "IMU init failed; ";
  }

  bno085.enableReport(SH2_ROTATION_VECTOR);

  NMEA2000.SetProductInformation("1", 1, "ESP32 Feather", "1.0", "1.0");
  NMEA2000.SetDeviceInformation(25, 130, 75, 2046);
  NMEA2000.SetMode(tNMEA2000::N2km_ListenOnly);
  NMEA2000.SetMsgHandler(HandleNMEA2000Msg);
  NMEA2000.Open();

  pinMode(LED_PIN, OUTPUT);

  // Initial SD write
  dataFile = SD.open("/datalog.txt", FILE_WRITE);
  if (dataFile) {
    dataFile.println("Hello from ESP32!");
    dataFile.println("Steve the GOAT");
    dataFile.close();
    Serial.println("Data written successfully.");
  } else {
    Serial.println("Error opening file.");
    error += "Initial SD file open failed; ";
  }

  Serial.println("System ready");

}

void loop() {
  if (!SD.begin(cs, SPI, 400000)) {
    error += "SD remount failed; ";
    digitalWrite(LED_PIN, HIGH);
    delay(1000);
    digitalWrite(LED_PIN, LOW);
    delay(1000);
  }

  NMEA2000.ParseMessages();
  updateIMU();

  if (millis() - lastSampleTime >= SAMPLE_INTERVAL) {
    lastSampleTime = millis();

    error = ""; // Reset errors for this cycle

    readGNSS();

    if (imuCount > 0) {
      imu_heading = imuSum / imuCount;
    } else {
      error += "No IMU samples this cycle; ";
    }

    imuSum   = 0;
    imuCount = 0;

    double deg2rad = PI / 180.0;
    double cogRad  = COG * deg2rad;

    double windDirRad = (AWA + imu_heading + 180.0) * deg2rad;

    AWS_x = AWS * sin(windDirRad);
    AWS_y = AWS * cos(windDirRad);

    SOG_x = SOG * sin(cogRad);
    SOG_y = SOG * cos(cogRad);

    TWS_x = AWS_x + SOG_x;
    TWS_y = AWS_y + SOG_y;

    TWS = sqrt(TWS_x * TWS_x + TWS_y * TWS_y);

    TWD = atan2(TWS_x, TWS_y) * 180.0 / PI;
    TWD = TWD + 180.0;
    if (TWD >= 360.0) TWD -= 360.0;

    double headingRad = imu_heading * deg2rad;

    STW_x = STW * sin(headingRad);
    STW_y = STW * cos(headingRad);

    Current_x = SOG_x - STW_x;
    Current_y = SOG_y - STW_y;

    CurrentSpeed = sqrt(Current_x * Current_x + Current_y * Current_y);

    CurrentDir = atan2(Current_x, Current_y) * 180.0 / PI;
    if (CurrentDir < 0) CurrentDir += 360.0;

    // Print
    Serial.print("Lat: ");            
    Serial.println(lat, 6);
    Serial.print("Lon: ");            
    Serial.println(lon, 6);
    Serial.print("Alt: ");            
    Serial.println(altitude);
    Serial.print("SOG (knots): ");    
    Serial.println(SOG);
    Serial.print("COG (deg): ");      
    Serial.println(COG);

    Serial.print("UTC: ");
    if (hour < 10) {
      Serial.print("0"); 
      Serial.print(hour);   
      Serial.print(":");
    } 
    if (minute < 10) {
      Serial.print("0"); 
      Serial.print(minute); 
      Serial.print(":");
    }
    if (second < 10) {
      Serial.print("0"); 
      Serial.println(second);
    }
    
    Serial.print("IMU Heading (avg): ");        
    Serial.println(imu_heading);
    Serial.print("True wind speed (knots): ");  
    Serial.println(TWS);
    Serial.print("True wind direction (deg): "); 
    Serial.println(TWD);
    Serial.print("True current speed (knots): "); 
    Serial.println(CurrentSpeed);
    Serial.print("True current direction (deg): "); 
    Serial.println(CurrentDir);

    if (error.length() > 0) {
      Serial.print("Errors: ");
      Serial.println(error);
    }

    if (millis() - lastTransmitTime >= TRANSMIT_INTERVAL) {
      lastTransmitTime = millis();
      error = ""; // Reset errors at the start of each transmit cycle
      Serial.println("Transmitting data...");
      writeToBlues();
      writeToSD();
    }
  }
}