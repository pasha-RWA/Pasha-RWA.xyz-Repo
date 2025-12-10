class Calculator {
    constructor(previousElement, currentElement) {
        this.previousElement = previousElement;
        this.currentElement = currentElement;
        this.clear();
    }

    clear() {
        this.currentOperand = '0';
        this.previousOperand = '';
        this.operation = undefined;
        this.updateDisplay();
    }

    delete() {
        if (this.currentOperand === '0') return;
        if (this.currentOperand.length === 1) {
            this.currentOperand = '0';
        } else {
            this.currentOperand = this.currentOperand.slice(0, -1);
        }
        this.updateDisplay();
    }

    appendNumber(number) {
        if (number === '.' && this.currentOperand.includes('.')) return;
        if (this.currentOperand === '0' && number !== '.') {
            this.currentOperand = number;
        } else {
            this.currentOperand += number;
        }
        this.updateDisplay();
    }

    chooseOperation(operation) {
        if (this.currentOperand === '') return;
        if (this.previousOperand !== '') {
            this.compute();
        }
        this.operation = operation;
        this.previousOperand = this.currentOperand + ' ' + operation;
        this.currentOperand = '0';
        this.updateDisplay();
    }

    compute() {
        let computation;
        const prev = parseFloat(this.previousOperand);
        const current = parseFloat(this.currentOperand);

        if (isNaN(prev) || isNaN(current)) return;

        switch (this.operation) {
            case '+':
                computation = prev + current;
                break;
            case '-':
                computation = prev - current;
                break;
            case '×':
                computation = prev * current;
                break;
            case '÷':
                if (current === 0) {
                    alert('Cannot divide by zero!');
                    this.clear();
                    return;
                }
                computation = prev / current;
                break;
            default:
                return;
        }

        this.currentOperand = this.roundNumber(computation).toString();
        this.operation = undefined;
        this.previousOperand = '';
        this.updateDisplay();
    }

    roundNumber(num) {
        return Math.round(num * 100000000) / 100000000;
    }

    getDisplayNumber(number) {
        const stringNumber = number.toString();
        const integerDigits = parseFloat(stringNumber.split('.')[0]);
        const decimalDigits = stringNumber.split('.')[1];
        let integerDisplay;

        if (isNaN(integerDigits)) {
            integerDisplay = '';
        } else {
            integerDisplay = integerDigits.toLocaleString('en', {
                maximumFractionDigits: 0
            });
        }

        if (decimalDigits != null) {
            return `${integerDisplay}.${decimalDigits}`;
        } else {
            return integerDisplay;
        }
    }

    updateDisplay() {
        this.currentElement.textContent = this.getDisplayNumber(this.currentOperand);
        this.previousElement.textContent = this.previousOperand;
    }
}

const previousElement = document.getElementById('previous');
const currentElement = document.getElementById('current');
const calculator = new Calculator(previousElement, currentElement);

document.addEventListener('keydown', function(event) {
    if (event.key >= 0 && event.key <= 9) {
        calculator.appendNumber(event.key);
    }
    if (event.key === '.') {
        calculator.appendNumber('.');
    }
    if (event.key === 'Enter' || event.key === '=') {
        calculator.compute();
    }
    if (event.key === 'Backspace') {
        calculator.delete();
    }
    if (event.key === 'Escape') {
        calculator.clear();
    }
    if (event.key === '+' || event.key === '-') {
        calculator.chooseOperation(event.key);
    }
    if (event.key === '*') {
        calculator.chooseOperation('×');
    }
    if (event.key === '/') {
        event.preventDefault();
        calculator.chooseOperation('÷');
    }
});
