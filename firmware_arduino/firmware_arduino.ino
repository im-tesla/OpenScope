/*
    Arduino Mega 2560 Stepper Serial Controller
    -------------------------------------------
    Pins:
    X_STEP_PIN    54
    X_DIR_PIN     55
    X_ENABLE_PIN  38
    X_CS_PIN      53

    Features:
    - Precise pulse timing
    - Motor auto-disable after movement
    - Absolute and relative movement
    - Left / right movement
    - Adjustable speed
    - Adjustable acceleration
    - Adjustable pulse width
    - Adjustable auto-disable timeout
    - Position tracking
    - Emergency stop
    - Continuous movement mode
    - Status reporting

    SERIAL COMMANDS
    ----------------

    MOVE <steps>
        Relative move
        Positive = right
        Negative = left

    GOTO <position>
        Move to absolute position

    LEFT <steps>
    RIGHT <steps>

    SPEED <steps_per_sec>

    ACCEL <steps_per_sec2>

    PULSE <microseconds>
        STEP pulse width

    HOLD <milliseconds>
        Time before disabling motor after move

    ENABLE
    DISABLE

    STOP
        Emergency stop

    ZERO
        Reset current position to 0

    STATUS

    RUNLEFT
    RUNRIGHT
        Continuous movement

    Example:
        MOVE 1000
        MOVE -500
        RIGHT 2000
        LEFT 1000
        SPEED 3000
        ACCEL 8000
        GOTO 0
*/

#define X_STEP_PIN         60
#define X_DIR_PIN          61
#define X_ENABLE_PIN       56
#define X_CS_PIN           49

// ---------------- SETTINGS ----------------

long currentPosition = 0;
long targetPosition = 0;

float maxSpeed = 10.0;      // steps/sec
float acceleration = 1.0;  // steps/sec^2

unsigned int pulseWidth = 3;  // microseconds
unsigned long holdTime = 0; // ms before disabling motor

bool motorEnabled = false;
bool movingContinuous = false;
int continuousDir = 1;

bool stopRequested = false;

// ------------------------------------------

void enableMotor() {
    digitalWrite(X_ENABLE_PIN, LOW); // LOW = enabled on most drivers
    motorEnabled = true;
}

void disableMotor() {
    digitalWrite(X_ENABLE_PIN, HIGH);
    motorEnabled = false;
}

void stepMotor(bool dir) {
    digitalWrite(X_DIR_PIN, dir);

    digitalWrite(X_STEP_PIN, HIGH);
    delayMicroseconds(pulseWidth);
    digitalWrite(X_STEP_PIN, LOW);
}

void moveSteps(long steps) {
    if (steps == 0) return;

    stopRequested = false;

    enableMotor();

    bool dir = (steps > 0);
    long totalSteps = abs(steps);

    float currentSpeed = 0;
    float stepDelay;

    long accelSteps = (maxSpeed * maxSpeed) / (2.0 * acceleration);

    if (accelSteps * 2 > totalSteps)
        accelSteps = totalSteps / 2;

    for (long i = 0; i < totalSteps; i++) {

        if (stopRequested) {
            Serial.println("STOPPED");
            break;
        }

        // Acceleration ramp
        if (i < accelSteps) {
            currentSpeed += acceleration / maxSpeed;
            if (currentSpeed > maxSpeed)
                currentSpeed = maxSpeed;
        }
        // Deceleration ramp
        else if (i >= totalSteps - accelSteps) {
            currentSpeed -= acceleration / maxSpeed;
            if (currentSpeed < 100)
                currentSpeed = 100;
        }
        else {
            currentSpeed = maxSpeed;
        }

        stepDelay = 1000000.0 / currentSpeed;

        stepMotor(dir);

        if (dir)
            currentPosition++;
        else
            currentPosition--;

        delayMicroseconds((unsigned long)stepDelay);
    }

    delay(holdTime);

    disableMotor();

    Serial.print("POS ");
    Serial.println(currentPosition);
}

void printStatus() {
    Serial.println("------ STATUS ------");
    Serial.print("Position: ");
    Serial.println(currentPosition);

    Serial.print("Speed: ");
    Serial.println(maxSpeed);

    Serial.print("Acceleration: ");
    Serial.println(acceleration);

    Serial.print("Pulse Width: ");
    Serial.println(pulseWidth);

    Serial.print("Hold Time: ");
    Serial.println(holdTime);

    Serial.print("Motor Enabled: ");
    Serial.println(motorEnabled ? "YES" : "NO");

    Serial.println("--------------------");
}



void processCommand(String cmd) {
    cmd.trim();
    cmd.toUpperCase();

    if (cmd.startsWith("MOVE ")) {
        long val = cmd.substring(5).toInt();
        moveSteps(val);
    }

    else if (cmd.startsWith("LEFT ")) {
        long val = cmd.substring(5).toInt();
        moveSteps(-val);
    }

    else if (cmd.startsWith("RIGHT ")) {
        long val = cmd.substring(6).toInt();
        moveSteps(val);
    }

    else if (cmd.startsWith("GOTO ")) {
        long pos = cmd.substring(5).toInt();
        long delta = pos - currentPosition;
        moveSteps(delta);
    }

    else if (cmd.startsWith("SPEED ")) {
        maxSpeed = cmd.substring(6).toFloat();
        Serial.println("OK");
    }

    else if (cmd.startsWith("ACCEL ")) {
        acceleration = cmd.substring(6).toFloat();
        Serial.println("OK");
    }

    else if (cmd.startsWith("PULSE ")) {
        pulseWidth = cmd.substring(6).toInt();
        Serial.println("OK");
    }

    else if (cmd.startsWith("HOLD ")) {
        holdTime = cmd.substring(5).toInt();
        Serial.println("OK");
    }

    else if (cmd == "ENABLE") {
        enableMotor();
        Serial.println("ENABLED");
    }

    else if (cmd == "DISABLE") {
        disableMotor();
        Serial.println("DISABLED");
    }

    else if (cmd == "STOP") {
        stopRequested = true;
        movingContinuous = false;
    }

    else if (cmd == "ZERO") {
        currentPosition = 0;
        Serial.println("ZEROED");
    }

    else if (cmd == "STATUS") {
        printStatus();
    }

    else if (cmd == "RUNLEFT") {
        enableMotor();
        movingContinuous = true;
        continuousDir = 0;
    }

    else if (cmd == "RUNRIGHT") {
        enableMotor();
        movingContinuous = true;
        continuousDir = 1;
    }

    else {
        Serial.println("UNKNOWN COMMAND");
    }
}

void setup() {
    pinMode(X_STEP_PIN, OUTPUT);
    pinMode(X_DIR_PIN, OUTPUT);
    pinMode(X_ENABLE_PIN, OUTPUT);
    pinMode(X_CS_PIN, OUTPUT);

    disableMotor();

    Serial.begin(115200);

    Serial.println("Stepper Controller Ready");
}

void loop() {

    if (Serial.available()) {
        String cmd = Serial.readStringUntil('\n');
        processCommand(cmd);
    }

    if (movingContinuous) {

        if (stopRequested) {
            movingContinuous = false;
            disableMotor();
            return;
        }

        stepMotor(continuousDir);

        if (continuousDir)
            currentPosition++;
        else
            currentPosition--;

        delayMicroseconds(1000000.0 / maxSpeed);
    }
}
