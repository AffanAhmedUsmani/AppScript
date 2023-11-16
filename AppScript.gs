// Replace these values with your own
var spreadsheet_url = "https://docs.google.com/spreadsheets/d/your_spreadsheet_id/edit?usp=sharing";
var sheet_name = "YourSheetName";
var notification_mail = "your_email@example.com";
var percentage_alert = 0; // if campaign spent yesterday below this percentage of daily spend, alert by mail

// Other variable declarations...

// Main function that orchestrates the script
function main() {
  let resultVariable;
  let resultVariable2;
  var campaign_list = get_data_from_spreadsheet();

  resultVariable = check_and_pause_unlisted_campaigns(campaign_list);
  if (resultVariable == false) {
    check_yesterday_spend(campaign_list);

    resultVariable2 = check_total_spend(campaign_list);
    if (resultVariable2 == false) {
      calculate_daily_budget(campaign_list);
    } else {
      Logger.log("Stopping the script");
    }
  } else {
    Logger.log("Stopping the script");
  }
}


// Retrieves campaign data from the specified Google Sheet
function get_data_from_spreadsheet() {
  var data = {};
  var ss = SpreadsheetApp.openByUrl(spreadsheet_url);
  var kws_array = ss.getSheetByName(sheet_name).getRange('A:E').getValues();
  var kws = [];

  // Iterates through rows in the sheet and extracts campaign data
  for (var i = 1; i < kws_array.length; i++) {
    if (kws_array[i][0] != "") {
      var campaign_name = kws_array[i][0];
      var start_date = date_formater(add_day(kws_array[i][2]));
      var end_date = date_formater(add_day(kws_array[i][3]));
      data[campaign_name] = {
        campaign_name: campaign_name,
        campaign_type: kws_array[i][1],
        start_date: start_date,
        end_date: end_date,
        budget: kws_array[i][4]
      };
    }
  }
  return data;
}

// Checks yesterday's spend and sends an email alert if below a certain percentage
function check_yesterday_spend(campaign_list) {
  var campaigns_not_spending = [];

  for (campaign_name in campaign_list) {
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday = date_formater(yesterday);
    var yesterday_spend = check_campaign_spend(
      campaign_name,
      yesterday,
      yesterday
    );
    var daily_budget = get_campaign_daily_budget(campaign_name);

    if (yesterday_spend > 0) {
      // Log spend information and update the spreadsheet
      Logger.log("Spend pushed to column F for campaign: " + campaign_name);
      update_spend_column(campaign_name, yesterday_spend);
    }

    if (yesterday_spend < 0.7 * daily_budget) {
      campaigns_not_spending.push(campaign_name);
    }
  }

  if (campaigns_not_spending.length > 0 && (hour > 7 && hour < 9)) {
    var msg =
      "The following campaign(s) spent yesterday less than " +
      percentage_alert * 100 +
      "% of daily budget:<br/>" +
      campaigns_not_spending.toString().split(",").join("<br/>");

    // Send an email alert
    sendEmailWithGmailAPI(
      notification_mail,
      "Google Ads Script Alert",
      msg
    );
  }
}

// Checks total spend for each campaign and pauses if it exceeds the budget or reaches the end date
function check_total_spend(campaign_list) {
  let isConditionTrue;
  isConditionTrue = false;
  for (campaign_name in campaign_list) {
    var today = new Date();
    today = date_formater(today);
    var start_date = campaign_list[campaign_name].start_date;
    var budget = campaign_list[campaign_name].budget;
    var total_spend = check_campaign_spend(
      campaign_name,
      start_date,
      today
    );

    if (total_spend > budget || today > campaign_list[campaign_name].end_date) {
      Logger.log("Campaign paused due to exceeding budget or reaching end date: " + campaign_name);
      pause_campaign(campaign_name);
      isConditionTrue = true;
    }

    if (total_spend <= budget && today <= campaign_list[campaign_name].end_date) {
      // Only enable if the campaign is currently paused
      if (is_campaign_paused(campaign_name)) {
        Logger.log("Campaign activated due to not reaching budget and having a future end date: " + campaign_name);
        enable_campaign(campaign_name);
      }
      isConditionTrue = true;
    }
  }
  return isConditionTrue;
}

// Calculates and sets daily budgets for campaigns based on remaining budget and days left
function calculate_daily_budget(campaign_list) {
  for (campaign_name in campaign_list) {
    Logger.log("going over " + campaign_name);
    var yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday = date_formater(yesterday);
    var today = new Date();
    today = date_formater(today);
    var start_date = campaign_list[campaign_name].start_date;
    var end_date = campaign_list[campaign_name].end_date;
    var budget = campaign_list[campaign_name].budget;
    var total_spend_until_yesterday = check_campaign_spend(campaign_name, start_date, yesterday);
    var days_left = date_diff(end_date, yesterday);
    var daily_budget = Math.floor((budget - total_spend_until_yesterday) * 10 / (days_left)) / 10;
    // Set the calculated daily budget for the campaign
    set_daily_budget(campaign_name, daily_budget);
  }
}

// Helper function to update spend information in the Google Sheet
function update_spend_column(campaign_name, spend_amount) {
  // Open the specified Google Sheet
  var ss = SpreadsheetApp.openByUrl(spreadsheet_url);
  
  // Get the sheet by name
  var sheet = ss.getSheetByName(sheet_name);

  // Find the row index of the campaign in the sheet
  var rowIndex = find_campaign_row(sheet, campaign_name);

  if (rowIndex !== -1) {
    // Update spend in column F
    sheet.getRange(rowIndex, 6).setValue(spend_amount);
    Logger.log("Spend updated in column F for campaign: " + campaign_name);
  } else {
    // Log an error if the campaign is not found in the spreadsheet
    Logger.log("Campaign not found in the spreadsheet: " + campaign_name);
  }
}

// Helper function to find the row index of a campaign in the sheet
function find_campaign_row(sheet, campaign_name) {
  // Get the data from the entire sheet
  var data = sheet.getDataRange().getValues();

  // Iterate through each row
  for (var i = 1; i < data.length; i++) {
    // Check if the campaign name matches in the first column
    if (data[i][0] === campaign_name) {
      // Return the row index (adding 1 because array indices start from 0, and row indices start from 1 in Google Sheets)
      return i + 1;
    }
  }

  // Return -1 if the campaign is not found in the sheet
  return -1;
}

// Enables a campaign in Google Ads
function enable_campaign(name) {
  // Get an iterator for the campaigns with the specified name
  const campaignIterator = AdsApp.campaigns()
    .withCondition(`Name = "${name}"`)
    .get();

  // Check if there is a campaign with the specified name
  if (campaignIterator.hasNext()) {
    // Enable the campaign
    const campaign = campaignIterator.next();
    campaign.enable();
    Logger.log("Campaign enabled: " + name);
  } else {
    // Log an error if no campaign is found with the specified name
    throw new Error(`No campaign named "${name}" found`);
  }
}

// Checks if a campaign is paused
function is_campaign_paused(campaign_name) {
  // Get an iterator for the campaigns with the specified name
  var campaigns = AdsApp.campaigns()
    .withCondition('Name = "' + campaign_name + '"')
    .get();

  // Check if there is a campaign with the specified name
  if (campaigns.hasNext()) {
    // Log whether the campaign is paused
    var cmp = campaigns.next();
    return cmp.isPaused();
  } else {
    // Log an error if no campaign is found with the specified name
    Logger.log("Campaign not found: " + campaign_name);
    return false;
  }
}

// Helper function to check the spend of a campaign within a specified date range
function check_campaign_spend(campaign_name, start_date, end_date) {
  // Get an iterator for the campaigns with the specified name
  var campaigns = AdsApp.campaigns().withCondition('Name = "' + campaign_name + '"').get();

  // Check if there is a campaign with the specified name
  if (campaigns.hasNext()) {
    // Get the campaign and retrieve spend statistics for the specified date range
    var cmp = campaigns.next();
    if (end_date < start_date) {
      start_date = end_date;
    }
    var stats = cmp.getStatsFor(start_date, end_date);
    var spend = stats.getCost();
    return spend;
  }
}

// Helper function to get the daily budget of a campaign
function get_campaign_daily_budget(campaign_name) {
  // Get an iterator for the campaigns with the specified name
  var campaigns = AdsApp.campaigns().withCondition('Name = "' + campaign_name + '"').get();

  // Check if there is a campaign with the specified name
  if (campaigns.hasNext()) {
    // Get the campaign and retrieve the daily budget
    var cmp = campaigns.next();
    var budget = cmp.getBudget().getAmount();
    return budget;
  }
}

// Pauses a campaign
function pause_campaign(name) {
  // Get an iterator for the campaigns with the specified name
  const campaignIterator = AdsApp.campaigns().withCondition(`Name = "${name}"`).get();

  // Check if there is a campaign with the specified name
  if (campaignIterator.hasNext()) {
    // Pause the campaign
    const campaign = campaignIterator.next();
    campaign.pause();
  } else {
    // Log an error if no campaign is found with the specified name
    throw new Error(`No campaign named "${name}" found`);
  }
}

// Sets the daily budget for a campaign
function set_daily_budget(campaign_name, amount) {
  // Get an iterator for the campaigns with the specified name and in ENABLED status
  var campaigns = AdsApp.campaigns().withCondition('Name = "' + campaign_name + '"').withCondition('Status = ENABLED').get();

  // Check if there is a campaign with the specified name and is enabled
  if (campaigns.hasNext()) {
    // Get the campaign, retrieve the current budget, and set the new daily budget
    var cmp = campaigns.next();
    var prev_budget = cmp.getBudget().getAmount();
    var budget = cmp.getBudget().setAmount(amount);
    return budget;
  }
}

// Helper function to format a date as YYYYMMDD
function date_formater(full_date) {
  // Convert the full date to a formatted string in YYYYMMDD format
  var the_date = new Date(full_date);
  var year = (the_date.getFullYear()).toString();
  var month = (the_date.getMonth() + 1).toString();
  if (month < 10) { month = "0" + month; }
  var day = (the_date.getDate()).toString();
  if (day < 10) { day = "0" + day; }
  return (year + month + day);
}

// Adds a day to a given date
function add_day(date) {
  // Create a new date by adding one day to the provided date
  var new_date = new Date(date);
  new_date.setDate(new_date.getDate() + 1);
  return new_date;
}

// Calculates the difference in days between two dates
function date_diff(later_date, early_date) {
  // Convert the date strings to Date objects
  later_date = new Date([later_date.slice(0, 4), "-", later_date.slice(4, 6), "-", later_date.slice(6, 8)].join(''));
  early_date = new Date([early_date.slice(0, 4), "-", early_date.slice(4, 6), "-", early_date.slice(6, 8)].join(''));

  // Calculate the difference in days
  var one_day = 1000 * 60 * 60 * 24;
  var result = Math.round(later_date - early_date) / (one_day);
  return result.toFixed(0);
}

// Checks and pauses campaigns that are not listed in the provided spreadsheet
function check_and_pause_unlisted_campaigns(spreadsheetCampaigns) {
  // Ensure that the input is an array
  if (!Array.isArray(spreadsheetCampaigns)) {
    // If spreadsheetCampaigns is not an array, handle the error or log a message
    Logger.log("Error: spreadsheetCampaigns is not an array");
    return false;
  }

  // Array to store unlisted campaigns
  var unlistedCampaigns = [];
  let isConditionTrue;
  isConditionTrue = false;

  // Iterate through different campaign types
  var campaignIterators = [
    AdsApp.campaigns().withCondition("Status = ENABLED").get(),
    // Add other campaign types if needed
  ];

  // Iterate through each campaign type
  for (var campaignIterator of campaignIterators) {
    // Iterate through each campaign
    while (campaignIterator.hasNext()) {
      var campaign = campaignIterator.next();
      var campaignName = campaign.getName();

      // Check if campaignName is not in the spreadsheetCampaigns array
      if (spreadsheetCampaigns.indexOf(campaignName) === -1) {
        // Pause the campaign and log information
        pause_campaign(campaignName);
        isConditionTrue = true;
        unlistedCampaigns.push(campaignName);
      }
    }
  }

  // Send an email alert if there are unlisted campaigns and the specified conditions are met
  if (unlistedCampaigns.length > 0 && (hour > 7 && hour < 9)) {
    var msg =
      "The following campaign(s) are not listed in the spreadsheet and have been paused:<br/>" +
      unlistedCampaigns.join("<br/>");
    MailApp.sendEmail({
      to: notification_mail,
      subject: "Google Ads Script Alert",
      htmlBody: msg,
    });
  }

  return isConditionTrue;
}

